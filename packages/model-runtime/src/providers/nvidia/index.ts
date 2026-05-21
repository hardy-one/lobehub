import { ModelProvider, nvidia as nvidiaChatModels } from 'model-bank';

import { type OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

// Models that support preserved thinking (enable_thinking + clear_thinking parameters)
// Ref: https://docs.z.ai/guides/capabilities/thinking-mode#preserved-thinking
const supportPreservedThinkingModels = new Set(['z-ai/glm-5.1']);

// Models that use enable_thinking parameter (without clear_thinking)
// Ref: NVIDIA NIM
const enableThinkingModels = new Set(['qwen/qwen3.5-397b-a17b']);

// Models that require reasoning_content on all assistant messages when thinking is enabled.
// Without this, multi-turn tool-call conversations return HTTP 400.
const forceReasoningModels = new Set([
  'z-ai/glm-5.1',
  'deepseek-ai/deepseek-v4-flash',
  'deepseek-ai/deepseek-v4-pro',
  'moonshotai/kimi-k2.6',
]);

export interface NvidiaModelCard {
  id: string;
}

export const params = {
  baseURL: 'https://integrate.api.nvidia.com/v1',
  chatCompletion: {
    // NVIDIA NIM rejects requests where prompt tokens already meet or
    // exceed the model context window (returns 400 "requested 0 output
    // tokens and your prompt contains at least N+1 input tokens"). Fail
    // fast so the UI can surface a fork / switch-model affordance instead
    // of a raw provider error. See LOBE-8974.
    contextPreFlight: { models: nvidiaChatModels },
    handlePayload: (payload) => {
      const { model, reasoning_effort, thinking, messages, ...rest } = payload;

      // Convert thinking.type to boolean for API
      const thinkingFlag =
        thinking?.type === 'enabled' ? true : thinking?.type === 'disabled' ? false : undefined;

      // When thinking is enabled, models like GLM-5.1, DeepSeek V4, and Kimi K2.6
      // require reasoning_content on all assistant messages in history, or the API
      // returns HTTP 400 on follow-up turns with tool calls.
      const shouldForceAssistantReasoningContent =
        thinkingFlag === true && typeof model === 'string' && forceReasoningModels.has(model);

      const processedMessages = messages?.map((message: any) => {
        if (message.role !== 'assistant') return message;

        const { reasoning, ...rest } = message;
        const reasoningContent =
          typeof rest.reasoning_content === 'string'
            ? rest.reasoning_content
            : typeof reasoning?.content === 'string'
              ? reasoning.content
              : undefined;

        if (shouldForceAssistantReasoningContent) {
          return { ...rest, reasoning_content: reasoningContent ?? '' };
        }

        if (reasoningContent !== undefined) {
          return { ...rest, reasoning_content: reasoningContent };
        }

        return rest;
      });

      // Check if model uses preserved thinking (enable_thinking + clear_thinking)
      const usePreservedThinking = model && supportPreservedThinkingModels.has(model);
      // Check if model uses enable_thinking parameter (without clear_thinking)
      const useEnableThinking = model && enableThinkingModels.has(model);

      const chatTemplateKwargs: Record<string, any> = {};

      if (thinkingFlag !== undefined) {
        if (usePreservedThinking) {
          // Models with preserved thinking: use enable_thinking + clear_thinking
          // set clear_thinking to false to preserve reasoning content across turns
          chatTemplateKwargs.enable_thinking = thinkingFlag;
          chatTemplateKwargs.clear_thinking = false;
        } else if (useEnableThinking) {
          // Models using enable_thinking: use enable_thinking only
          chatTemplateKwargs.enable_thinking = thinkingFlag;
        } else {
          // Other models: use thinking parameter
          chatTemplateKwargs.thinking = thinkingFlag;
        }
      }

      // DeepSeek V4 on NVIDIA NIM expects reasoning_effort inside chat_template_kwargs
      if (reasoning_effort && typeof model === 'string' && model.startsWith('deepseek-ai/deepseek-v4')) {
        chatTemplateKwargs.reasoning_effort = reasoning_effort;
      }

      return {
        ...rest,
        model,
        messages: processedMessages,
        // Send chat_template_kwargs when thinking is explicitly set
        ...(Object.keys(chatTemplateKwargs).length > 0
          ? { chat_template_kwargs: chatTemplateKwargs }
          : {}),
      } as any;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_NVIDIA_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList: NvidiaModelCard[] = modelsPage.data;

    return processMultiProviderModelList(modelList, 'nvidia');
  },
  provider: ModelProvider.Nvidia,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeNvidiaAI = createOpenAICompatibleRuntime(params);
