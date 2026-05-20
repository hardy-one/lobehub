import { ModelProvider } from 'model-bank';
import type OpenAI from 'openai';

import { createRouterRuntime } from '../../core/RouterRuntime';
import type { CreateRouterRuntimeOptions } from '../../core/RouterRuntime/createRuntime';
import type { ChatStreamPayload } from '../../types';
import { processMultiProviderModelList } from '../../utils/modelParse';

const GO_BASE_URL = 'https://opencode.ai/zen/go/v1';

// MiniMax models in Go use @ai-sdk/anthropic (Anthropic Messages API format)
// Endpoint: /go/v1/messages
const minimaxModels = ['minimax-m2.5', 'minimax-m2.7'];

// Moonshot Kimi thinking toggle models (kimi-k2.N) expose reasoning on the
// OpenAI-compatible route. Matches the official Moonshot provider's prefix logic.
const isKimiThinkingToggleModel = (model: string) => model.startsWith('kimi-k2.');

// Models that need reasoning → reasoning_content conversion.
const reasoningConvertModels = [
  'glm-5',
  'glm-5.1',
  'mimo-v2.5',
  'mimo-v2.5-pro',
  'deepseek-v4-pro',
  'deepseek-v4-flash',
  'qwen3.6-plus',
];

// Models that additionally require reasoning_content on all assistant messages
// when thinking is enabled — the underlying API gateway rejects (HTTP 400)
// follow-up turns that omit reasoning_content on assistant messages with tool calls.
const reasoningForceModels = ['deepseek-v4-pro', 'deepseek-v4-flash', 'mimo-v2.5', 'mimo-v2.5-pro'];

const hasValidReasoning = (reasoning: any) =>
  typeof reasoning?.content === 'string' && typeof reasoning?.signature !== 'string';

const isEmptyContent = (content: any) =>
  content === '' || content === null || content === undefined;

/**
 * Build OpenAI-compatible payload with reasoning_content handling.
 *
 * Applies to:
 *   - GLM-5/5.1, MiMo-V2.5/Pro, DeepSeek V4 Flash/Pro, Qwen3.6 Plus
 *     (reasoning → reasoning_content conversion)
 *   - Kimi K2.5/K2.6 (thinking mode reasoning_content, matching Moonshot official provider)
 *
 * For DeepSeek V4 Flash/Pro and MiMo-V2.5/Pro: forces `reasoning_content`
 * on assistant messages when thinking is enabled (default for these models).
 */
const buildOpenAIPayload = (
  payload: ChatStreamPayload,
): OpenAI.ChatCompletionCreateParamsStreaming => {
  const model = payload.model;
  const isKimi = isKimiThinkingToggleModel(model);
  const isConvertModel = reasoningConvertModels.some((m) => model?.includes(m));
  if (!isKimi && !isConvertModel) return payload as any;

  const isForcedReasoningModel = reasoningForceModels.some((m) => model?.includes(m));
  const kimiThinkingEnabled = isKimi && (payload as any).thinking?.type !== 'disabled';
  const thinkingExplicitlyDisabled = (payload as any).thinking?.type === 'disabled';
  const shouldForceAssistantReasoningContent =
    (isForcedReasoningModel && !thinkingExplicitlyDisabled) || kimiThinkingEnabled;

  const messages = payload.messages.map((message: any) => {
    const { reasoning, ...rest } = message;

    // Normalize empty content to space for Kimi (matching Moonshot provider)
    const normalized = isKimi && isEmptyContent(message.content) ? { ...rest, content: ' ' } : rest;

    const reasoningContent =
      typeof normalized.reasoning_content === 'string'
        ? normalized.reasoning_content
        : hasValidReasoning(reasoning)
          ? reasoning.content
          : undefined;

    if (message.role === 'assistant' && shouldForceAssistantReasoningContent) {
      return {
        ...normalized,
        reasoning_content: reasoningContent ?? '',
      };
    }

    if (reasoningContent !== undefined) {
      return {
        ...normalized,
        reasoning_content: reasoningContent,
      };
    }

    return normalized;
  });

  const { reasoning_effort, thinking, ...restPayload } = payload;

  return {
    ...restPayload,
    messages,
    ...(!thinkingExplicitlyDisabled && reasoning_effort ? { reasoning_effort } : {}),
    ...(thinking?.type === 'enabled' || thinking?.type === 'disabled'
      ? { thinking: { type: thinking.type } }
      : {}),
    stream: payload.stream ?? true,
  } as OpenAI.ChatCompletionCreateParamsStreaming;
};

// Anthropic SDK auto-appends /v1/messages to baseURL, so we need to strip trailing /v1
const stripV1 = (url?: string) => url?.replace(/\/v1$/, '');

export const params = {
  debug: {
    chatCompletion: () => process.env.DEBUG_OPENCODE_GO_CHAT_COMPLETION === '1',
  },
  id: ModelProvider.OpenCodeCodingPlan,
  models: async () => {
    const { opencodecodingplan } = await import('model-bank');
    return processMultiProviderModelList(
      opencodecodingplan.map((m: { id: string }) => ({ id: m.id })),
      'opencodecodingplan',
    );
  },
  routers: (options) => {
    const baseURL = options.baseURL || GO_BASE_URL;
    return [
      // Anthropic router for MiniMax models (use Anthropic Messages API format)
      {
        apiType: 'anthropic',
        models: minimaxModels,
        options: {
          ...options,
          baseURL: stripV1(baseURL),
        },
      },
      // OpenAI-compatible fallback for all other models (GLM, Kimi, MiMo, Qwen, DeepSeek)
      {
        apiType: 'openai',
        options: {
          ...options,
          baseURL,
          chatCompletion: {
            handlePayload: buildOpenAIPayload,
          },
        },
      },
    ];
  },
} satisfies CreateRouterRuntimeOptions;

export const LobeOpenCodeCodingPlanAI = createRouterRuntime(params);
