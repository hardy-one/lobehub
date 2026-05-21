import { ModelProvider } from 'model-bank';
import type OpenAI from 'openai';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
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

// Models with interleaved reasoning_content (from models.dev opencode-go)
// that use openai-compatible SDK. All of these need:
//   1. reason → reasoning_content conversion
//   2. reasoning_content forced on all assistant messages (fill '' if missing)
// Ref: https://models.dev/api.json → opencode-go
const reasoningInterleavedModels = [
  'glm-5',
  'glm-5.1',
  'mimo-v2.5',
  'mimo-v2.5-pro',
  'mimo-v2-omni',
  'mimo-v2-pro',
  'deepseek-v4-pro',
  'deepseek-v4-flash',
];

const hasValidReasoning = (reasoning: any) =>
  typeof reasoning?.content === 'string';

const isEmptyContent = (content: any) =>
  content === '' || content === null || content === undefined;

/**
 * Build OpenAI-compatible payload with reasoning_content handling.
 *
 * Applies to all models with interleaved reasoning_content (models.dev opencode-go):
 *   GLM-5/5.1, MiMo-V2.5/Pro, MiMo-V2-Omni/Pro, DeepSeek V4 Flash/Pro, Kimi K2.5/K2.6
 *
 * All of these get reason → reasoning_content conversion AND forced
 * reasoning_content on assistant messages when thinking is not explicitly disabled.
 */
const buildOpenAIPayload = (
  payload: ChatStreamPayload,
): OpenAI.ChatCompletionCreateParamsStreaming => {
  const model = payload.model;
  const isKimi = isKimiThinkingToggleModel(model);
  const isInterleavedModel = reasoningInterleavedModels.some((m) => model?.includes(m));
  if (!isKimi && !isInterleavedModel) return payload as any;

  const thinkingExplicitlyDisabled = (payload as any).thinking?.type === 'disabled';
  const shouldForceAssistantReasoningContent =
    (isInterleavedModel || isKimi) && !thinkingExplicitlyDisabled;

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
        reasoning_content: reasoningContent ?? ' ',
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

// Dedicated OpenAI-compatible runtime with buildOpenAIPayload baked into the
// factory closure. RouterRuntime creates instances of this class for all
// non-MiniMax models, ensuring reasoning_content is properly set on messages.
const LobeOpenCodeCodingPlanOpenAI = createOpenAICompatibleRuntime({
  provider: ModelProvider.OpenCodeCodingPlan,
  baseURL: GO_BASE_URL,
  chatCompletion: {
    handlePayload: buildOpenAIPayload,
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_OPENCODE_GO_CHAT_COMPLETION === '1',
  },
});

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
        runtime: LobeOpenCodeCodingPlanOpenAI as any,
        options: {
          ...options,
          baseURL,
        },
      },
    ];
  },
} satisfies CreateRouterRuntimeOptions;

export const LobeOpenCodeCodingPlanAI = createRouterRuntime(params);
