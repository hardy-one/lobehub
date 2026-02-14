import { type GenerateContentResponse, type Part } from '@google/genai';
import { type GroundingSearch } from '@lobechat/types';

import { type ChatStreamCallbacks } from '../../../types';
import { nanoid } from '../../../utils/uuid';
import { convertGoogleAIUsage } from '../../usageConverters/google-ai';
import {
  type ChatPayloadForTransformStream,
  type StreamContext,
  type StreamPartChunkData,
  type StreamProtocolChunk,
  type StreamToolCallChunkData,
} from '../protocol';
import {
  createCallbacksTransformer,
  createSSEProtocolTransformer,
  createTokenSpeedCalculator,
  generateToolCallId,
} from '../protocol';
import { GOOGLE_AI_BLOCK_REASON } from './const';

export const LOBE_ERROR_KEY = '__lobe_error';

const getBlockReasonMessage = (blockReason: string): string => {
  const blockReasonMessages = GOOGLE_AI_BLOCK_REASON;

  return (
    blockReasonMessages[blockReason as keyof typeof blockReasonMessages] ||
    blockReasonMessages.default.replace('{{blockReason}}', blockReason)
  );
};

/**
 * Parse function call from Google Part to StreamToolCallChunkData
 * Preserves original ID format for backward compatibility
 */
const parseGoogleFunctionCall = (part: Part, existingCount: number): StreamToolCallChunkData => {
  const { functionCall, thoughtSignature } = part;
  // Preserve original ID format: {name}_{index}_{nanoid}
  const id = generateToolCallId(existingCount, functionCall?.name || 'unknown');
  return {
    function: {
      arguments: JSON.stringify(functionCall?.args ?? {}),
      name: functionCall?.name ?? 'unknown',
    },
    id,
    index: existingCount,
    thoughtSignature,
    type: 'function',
  };
};

/**
 * Process parts independently - allows multiple types in the same chunk
 * This is the key difference from OpenAI: Gemini parts[] can contain
 * functionCall, text, inlineData simultaneously
 *
 * @param parts - Array of parts from Gemini response
 * @param context - Stream context with ID
 * @param isMultimodal - Whether to use content_part/reasoning_part events (for Gemini 2.5+)
 */
const processParts = (
  parts: Part[],
  context: StreamContext,
  isMultimodal: boolean = false,
): StreamProtocolChunk[] => {
  const events: StreamProtocolChunk[] = [];
  const functionCalls: StreamToolCallChunkData[] = [];

  for (const part of parts) {
    // 1. Handle functionCall - collect for batch emission
    if (part.functionCall) {
      functionCalls.push(parseGoogleFunctionCall(part, functionCalls.length));
    }

    // 2. Handle reasoning content (thought: true)
    if (part.text && part.thought === true) {
      if (isMultimodal) {
        events.push({
          data: {
            content: part.text,
            inReasoning: true,
            partType: 'text',
            thoughtSignature: part.thoughtSignature,
          } as StreamPartChunkData,
          id: context.id,
          type: 'reasoning_part',
        });
      } else {
        events.push({
          data: part.text,
          id: context.id,
          type: 'reasoning',
        });
      }
    }

    // 2b. Handle reasoning inlineData (thought: true)
    if (
      part.inlineData &&
      part.inlineData.data &&
      part.inlineData.mimeType &&
      part.thought === true
    ) {
      const mimeType = part.inlineData.mimeType;
      if (mimeType.startsWith('image/') && isMultimodal) {
        events.push({
          data: {
            content: part.inlineData.data,
            inReasoning: true,
            mimeType,
            partType: 'image',
            thoughtSignature: part.thoughtSignature,
          } as StreamPartChunkData,
          id: context.id,
          type: 'reasoning_part',
        });
      }
    }

    // 3. Handle regular text (reasoning: false/undefined)
    if (part.text && !part.thought) {
      if (isMultimodal) {
        events.push({
          data: {
            content: part.text,
            partType: 'text',
            thoughtSignature: part.thoughtSignature,
          } as StreamPartChunkData,
          id: context.id,
          type: 'content_part',
        });
      } else {
        events.push({
          data: part.text,
          id: context.id,
          type: 'text',
        });
      }
    }

    // 4. Handle inlineData (images) - non-reasoning only (reasoning handled above)
    if (part.inlineData && part.inlineData.data && part.inlineData.mimeType && !part.thought) {
      const mimeType = part.inlineData.mimeType;
      if (mimeType.startsWith('image/')) {
        if (isMultimodal) {
          events.push({
            data: {
              content: part.inlineData.data,
              mimeType,
              partType: 'image',
              thoughtSignature: part.thoughtSignature,
            } as StreamPartChunkData,
            id: context.id,
            type: 'content_part',
          });
        } else {
          events.push({
            data: `data:${mimeType};base64,${part.inlineData.data}`,
            id: context.id,
            type: 'base64_image',
          });
        }
      }
    }
  }

  // Emit tool_calls as a single batch event
  if (functionCalls.length > 0) {
    events.push({
      data: functionCalls,
      id: context.id,
      type: 'tool_calls',
    });
  }

  return events;
};

const transformGoogleGenerativeAIStream = (
  chunk: GenerateContentResponse,
  context: StreamContext,
  payload?: ChatPayloadForTransformStream,
): StreamProtocolChunk | StreamProtocolChunk[] => {
  // Handle injected internal error marker
  if ((chunk as any)?.[LOBE_ERROR_KEY]) {
    return {
      data: (chunk as any)[LOBE_ERROR_KEY],
      id: context?.id || 'error',
      type: 'error',
    };
  }

  // Handle promptFeedback with blockReason
  if ('promptFeedback' in chunk && (chunk as any).promptFeedback?.blockReason) {
    const blockReason = (chunk as any).promptFeedback.blockReason;
    const humanFriendlyMessage = getBlockReasonMessage(blockReason);

    return {
      data: {
        body: {
          context: { promptFeedback: (chunk as any).promptFeedback },
          message: humanFriendlyMessage,
          provider: 'google',
        },
        type: 'ProviderBizError',
      },
      id: context?.id || 'error',
      type: 'error',
    };
  }

  const candidate = chunk.candidates?.[0];
  const { usageMetadata } = chunk;
  const usageChunks: StreamProtocolChunk[] = [];

  // Build usage chunks
  if (candidate?.finishReason && usageMetadata) {
    usageChunks.push({ data: candidate.finishReason, id: context?.id, type: 'stop' });
    const convertedUsage = convertGoogleAIUsage(usageMetadata, payload?.pricing);
    if (convertedUsage) {
      usageChunks.push({ data: convertedUsage, id: context?.id, type: 'usage' });
    }
  }

  // Early exit for empty candidate
  if (!candidate) {
    return { data: '', id: context?.id, type: 'text' };
  }

  // Check model version for multimodal processing
  // Gemini 3 image models always use multimodal processing
  const modelVersion = (chunk as any).modelVersion || '';
  const isGemini3ImageModel =
    modelVersion.includes('gemini-3') || modelVersion.includes('image-preview');

  // Check for multimodal content (Gemini 2.5+ features)
  const parts = candidate.content?.parts || [];
  const hasReasoningParts = parts.some((p: any) => p.thought === true);
  const hasThoughtSignature = parts.some((p: any) => p.thoughtSignature);
  const hasThoughtsInMetadata = (usageMetadata as any)?.thoughtsTokenCount > 0;

  // For Gemini 3 image models, always use multimodal processing
  // For other models, use multimodal only for reasoning content
  const isMultimodal =
    isGemini3ImageModel || hasReasoningParts || hasThoughtSignature || hasThoughtsInMetadata;

  // Process parts with appropriate event types
  if (candidate.content?.parts) {
    const events = processParts(candidate.content.parts, context, isMultimodal);

    // Check for grounding metadata
    const hasFunctionCall = events.some((e) => e.type === 'tool_calls');
    const hasGroundingMetadata = !!candidate.groundingMetadata?.groundingChunks;

    if (hasGroundingMetadata && !hasFunctionCall) {
      const text = isMultimodal
        ? events
            .filter((e) => e.type === 'content_part')
            .map((e) => (e.data as StreamPartChunkData).content)
            .join('')
        : events
            .filter((e) => e.type === 'text')
            .map((e) => e.data as string)
            .join('');

      const { groundingChunks, webSearchQueries } = candidate.groundingMetadata ?? {};
      return [
        { data: text, id: context.id, type: 'text' },
        {
          data: {
            citations: groundingChunks?.map((chunk) => ({
              favicon: chunk.web?.title,
              title: chunk.web?.title,
              url: chunk.web?.uri,
            })),
            searchQueries: webSearchQueries,
          } as GroundingSearch,
          id: context.id,
          type: 'grounding',
        },
        ...usageChunks,
      ];
    }

    // Return processed events
    if (events.length > 0) {
      if (usageChunks.length > 0) {
        events.push(...usageChunks);
      }
      return events;
    }
  }

  // Handle finish reason without content
  if (candidate.finishReason) {
    // Don't emit empty text event if there's no content
    if (usageMetadata) {
      return usageChunks;
    }
    return [{ data: candidate.finishReason, id: context?.id, type: 'stop' }];
  }

  // Fallback for empty responses
  return { data: '', id: context?.id, type: 'text' };
};

export interface GoogleAIStreamOptions {
  callbacks?: ChatStreamCallbacks;
  enableStreaming?: boolean;
  inputStartAt?: number;
  payload?: ChatPayloadForTransformStream;
}

export const GoogleGenerativeAIStream = (
  rawStream: ReadableStream<GenerateContentResponse>,
  { callbacks, inputStartAt, enableStreaming = true, payload }: GoogleAIStreamOptions = {},
) => {
  const streamStack: StreamContext = { id: 'chat_' + nanoid() };

  const transformWithPayload: typeof transformGoogleGenerativeAIStream = (chunk, ctx) =>
    transformGoogleGenerativeAIStream(chunk, ctx, payload);

  return rawStream
    .pipeThrough(
      createTokenSpeedCalculator(transformWithPayload, {
        enableStreaming,
        inputStartAt,
        streamStack,
      }),
    )
    .pipeThrough(
      createSSEProtocolTransformer((c) => c, streamStack, { requireTerminalEvent: true }),
    )
    .pipeThrough(createCallbacksTransformer(callbacks));
};
