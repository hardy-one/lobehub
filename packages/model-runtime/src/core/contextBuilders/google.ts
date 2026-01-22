import {
  Content,
  FunctionDeclaration,
  Tool as GoogleFunctionCallTool,
  Part,
  Type as SchemaType,
} from '@google/genai';
import { imageUrlToBase64 } from '@lobechat/utils';

import { ChatCompletionTool, OpenAIChatMessage, UserMessageContentPart } from '../../types';
import { safeParseJSON } from '../../utils/safeParseJSON';
import { parseDataUri } from '../../utils/uriParser';

const GOOGLE_SUPPORTED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
]);

const isImageTypeSupported = (mimeType: string | null): boolean => {
  if (!mimeType) return true;
  return GOOGLE_SUPPORTED_IMAGE_TYPES.has(mimeType.toLowerCase());
};

/**
 * Magic thoughtSignature
 * @see https://ai.google.dev/gemini-api/docs/thought-signatures#model-behavior:~:text=context_engineering_is_the_way_to_go
 */
export const GEMINI_MAGIC_THOUGHT_SIGNATURE = 'context_engineering_is_the_way_to_go';

/**
 * Convert OpenAI content part to Google Part format
 */
export const buildGooglePart = async (
  content: UserMessageContentPart,
): Promise<Part | undefined> => {
  switch (content.type) {
    default: {
      return undefined;
    }

    case 'text': {
      return {
        text: content.text,
        thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE,
      };
    }

    case 'image_url': {
      const { mimeType, base64, type } = parseDataUri(content.image_url.url);

      if (type === 'base64') {
        if (!base64) {
          throw new TypeError("Image URL doesn't contain base64 data");
        }

        if (!isImageTypeSupported(mimeType)) return undefined;

        return {
          inlineData: { data: base64, mimeType: mimeType || 'image/png' },
          thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE,
        };
      }

      if (type === 'url') {
        const { base64, mimeType } = await imageUrlToBase64(content.image_url.url);

        if (!isImageTypeSupported(mimeType)) return undefined;

        return {
          inlineData: { data: base64, mimeType },
          thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE,
        };
      }

      throw new TypeError(`currently we don't support image url: ${content.image_url.url}`);
    }

    case 'video_url': {
      const { mimeType, base64, type } = parseDataUri(content.video_url.url);

      if (type === 'base64') {
        if (!base64) {
          throw new TypeError("Video URL doesn't contain base64 data");
        }

        return {
          inlineData: { data: base64, mimeType: mimeType || 'video/mp4' },
          thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE,
        };
      }

      if (type === 'url') {
        // Use imageUrlToBase64 for SSRF protection (works for any binary data including videos)
        // Note: This might need size/duration limits for practical use
        const { base64, mimeType } = await imageUrlToBase64(content.video_url.url);

        return {
          inlineData: { data: base64, mimeType },
          thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE,
        };
      }

      throw new TypeError(`currently we don't support video url: ${content.video_url.url}`);
    }
  }
};

/**
 * Convert OpenAI message to Google Content format
 * Note: For parallel tool calls, all tool responses should be in the same Content message
 */
export const buildGoogleMessage = async (
  message: OpenAIChatMessage,
  toolCallNameMap?: Map<string, string>,
): Promise<Content | null> => {
  const content = message.content as string | UserMessageContentPart[];

  // Handle assistant messages with tool_calls
  if (!!message.tool_calls) {
    return {
      parts: message.tool_calls.map<Part>((tool) => ({
        functionCall: {
          args: safeParseJSON(tool.function.arguments)!,
          name: tool.function.name,
        },
        thoughtSignature: tool.thoughtSignature,
      })),
      role: 'model',
    };
  }

  // Convert tool_call result to functionResponse part
  // Note: This will return null and the caller will aggregate all tool responses
  if (message.role === 'tool' && toolCallNameMap && message.tool_call_id) {
    const functionName = toolCallNameMap.get(message.tool_call_id);
    if (functionName) {
      return {
        parts: [
          {
            functionResponse: {
              name: functionName,
              response: { result: message.content },
            },
          },
        ],
        role: 'user',
      };
    }
    return null; // Skip if no matching function name
  }

  const getParts = async () => {
    if (typeof content === 'string')
      return [{ text: content, thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE }];

    const parts = await Promise.all(content.map(async (c) => await buildGooglePart(c)));
    return parts.filter(Boolean) as Part[];
  };

  return {
    parts: await getParts(),
    role: message.role === 'assistant' ? 'model' : 'user',
  };
};

/**
 * Count tool calls and responses in messages
 */
const countToolCallsAndResponses = (
  messages: OpenAIChatMessage[],
): {
  pendingToolCallIds: string[];
  toolCallCount: number;
  toolResponseCount: number;
} => {
  let toolCallCount = 0;
  const toolResponseIds = new Set<string>();

  for (const message of messages) {
    // Count tool calls from assistant messages
    if (message.role === 'assistant' && message.tool_calls) {
      for (const tc of message.tool_calls) {
        if (tc.type === 'function') {
          toolCallCount++;
        }
      }
    }

    // Track tool response IDs
    if (message.role === 'tool' && message.tool_call_id) {
      toolResponseIds.add(message.tool_call_id);
    }
  }

  // Find pending tool calls (calls without corresponding responses)
  const pendingToolCallIds: string[] = [];
  for (const message of messages) {
    if (message.role === 'assistant' && message.tool_calls) {
      for (const tc of message.tool_calls) {
        if (tc.type === 'function' && !toolResponseIds.has(tc.id)) {
          pendingToolCallIds.push(tc.id);
        }
      }
    }
  }

  return {
    pendingToolCallIds,
    toolCallCount,
    toolResponseCount: toolResponseIds.size,
  };
};

/**
 * Convert messages from the OpenAI format to Google GenAI SDK format
 * For parallel tool calls, all tool responses are aggregated into a single user message
 */
export const buildGoogleMessages = async (messages: OpenAIChatMessage[]): Promise<Content[]> => {
  // Check for pending tool calls that haven't received responses
  const { toolCallCount, toolResponseCount, pendingToolCallIds } =
    countToolCallsAndResponses(messages);

  if (toolCallCount > toolResponseCount && pendingToolCallIds.length > 0) {
    const pendingList = pendingToolCallIds.join(', ');
    throw new Error(
      `[Google AI] Mismatched tool calls and responses: ` +
        `${toolCallCount} calls, ${toolResponseCount} responses. ` +
        `Missing responses for tool calls: ${pendingList}. ` +
        `Please ensure all tool responses are collected before calling the model.`,
    );
  }

  const toolCallNameMap = new Map<string, string>();

  // Build tool call id to name mapping
  messages.forEach((message) => {
    if (message.role === 'assistant' && message.tool_calls) {
      message.tool_calls.forEach((toolCall) => {
        if (toolCall.type === 'function') {
          toolCallNameMap.set(toolCall.id, toolCall.function.name);
        }
      });
    }
  });

  const result: Content[] = [];
  let pendingToolResponseParts: Part[] = [];

  // Process messages, aggregating tool responses into a single user message
  for (const msg of messages) {

    // Handle tool role: aggregate all tool responses
    if (msg.role === 'tool') {
      const content = await buildGoogleMessage(msg, toolCallNameMap);
      if (content?.parts?.length) {
        pendingToolResponseParts.push(...content.parts);
      }
      continue;
    }

    // If we have pending tool responses and encounter a non-tool message,
    // flush the aggregated tool responses as a single user message
    if (pendingToolResponseParts.length > 0) {
      result.push({
        parts: pendingToolResponseParts,
        role: 'user',
      });
      pendingToolResponseParts = [];
    }

    // Process non-tool messages normally
    if (msg.role !== 'function') {
      const content = await buildGoogleMessage(msg, toolCallNameMap);
      if (content) {
        result.push(content);
      }
    }
  }

  // Flush any remaining tool responses at the end
  if (pendingToolResponseParts.length > 0) {
    result.push({
      parts: pendingToolResponseParts,
      role: 'user',
    });
  }

  // Filter out empty messages: contents.parts must not be empty
  const filteredContents = result.filter(
    (content: Content) => content.parts && content.parts.length > 0,
  );

  // Check if the last message is a tool message
  const lastMessage = messages.at(-1);
  const shouldAddMagicSignature = lastMessage?.role === 'tool';

  if (shouldAddMagicSignature) {
    // Find the last user message index in filtered contents
    let lastUserIndex = -1;
    for (let i = filteredContents.length - 1; i >= 0; i--) {
      if (filteredContents[i].role === 'user') {
        // Skip if it's a functionResponse (tool result)
        const hasFunctionResponse = filteredContents[i].parts?.some((p) => p.functionResponse);
        if (!hasFunctionResponse) {
          lastUserIndex = i;
          break;
        }
      }
    }

    // Add magic signature to all function calls after last user message that don't have thoughtSignature
    for (let i = lastUserIndex + 1; i < filteredContents.length; i++) {
      const content = filteredContents[i];
      if (content.role === 'model' && content.parts) {
        for (const part of content.parts) {
          if (part.functionCall && !part.thoughtSignature) {
            // Only add magic signature if thoughtSignature doesn't exist
            part.thoughtSignature = GEMINI_MAGIC_THOUGHT_SIGNATURE;
          }
        }
      }
    }
  }

  return filteredContents;
};

/**
 * Sanitize JSON Schema for Google GenAI compatibility
 * Google's API doesn't support certain JSON Schema keywords like 'const'
 * This function recursively processes the schema and converts unsupported keywords
 */
const sanitizeSchemaForGoogle = (schema: Record<string, any>): Record<string, any> => {
  if (!schema || typeof schema !== 'object') return schema;

  // Handle arrays
  if (Array.isArray(schema)) {
    return schema.map((item) => sanitizeSchemaForGoogle(item));
  }

  const result: Record<string, any> = {};

  for (const [key, value] of Object.entries(schema)) {
    // Convert 'const' to 'enum' with single value (Google doesn't support 'const')
    if (key === 'const') {
      result['enum'] = [value];
      continue;
    }

    // Recursively process nested objects
    if (value && typeof value === 'object') {
      result[key] = sanitizeSchemaForGoogle(value);
    } else {
      result[key] = value;
    }
  }

  return result;
};

/**
 * Convert ChatCompletionTool to Google FunctionDeclaration
 */
export const buildGoogleTool = (tool: ChatCompletionTool): FunctionDeclaration => {
  const functionDeclaration = tool.function;
  const parameters = functionDeclaration.parameters;
  // refs: https://github.com/lobehub/lobe-chat/pull/5002
  const rawProperties =
    parameters?.properties && Object.keys(parameters.properties).length > 0
      ? parameters.properties
      : { dummy: { type: 'string' } }; // dummy property to avoid empty object

  // Sanitize properties to remove unsupported JSON Schema keywords for Google
  const properties = sanitizeSchemaForGoogle(rawProperties);

  return {
    description: functionDeclaration.description,
    name: functionDeclaration.name,
    parameters: {
      description: parameters?.description,
      properties: properties,
      required: parameters?.required,
      type: SchemaType.OBJECT,
    },
  };
};

/**
 * Build Google function declarations from ChatCompletionTool array
 */
export const buildGoogleTools = (
  tools: ChatCompletionTool[] | undefined,
): GoogleFunctionCallTool[] | undefined => {
  if (!tools || tools.length === 0) return;

  return [
    {
      functionDeclarations: tools.map((tool) => buildGoogleTool(tool)),
    },
  ];
};
