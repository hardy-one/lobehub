import { ModelProvider, nvidia as nvidiaChatModels } from 'model-bank';

import { type OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

// Thinking param patterns derived from build.nvidia.com page templates
// Ref: /tmp/NVIDIA_28_Models_Analysis.md

// Pattern A: chat_template_kwargs.thinking (boolean toggle)
const chatTemplateKwargsThinkingModels = new Set([
  'moonshotai/kimi-k2.6',
]);

// Pattern B: chat_template_kwargs.enable_thinking (boolean toggle)
const enableThinkingModels = new Set([
  'google/gemma-4-31b-it',
  'nvidia/ising-calibration-1-35b-a3b',
  'nvidia/nemotron-3-nano-30b-a3b',
  'nvidia/nemotron-3-super-120b-a12b',
  'qwen/qwen3.5-122b-a10b',
]);

// Pattern C: chat_template_kwargs.enable_thinking + clear_thinking (preserved thinking)
// Ref: https://docs.z.ai/guides/capabilities/thinking-mode#preserved-thinking
const preservedThinkingModels = new Set(['z-ai/glm-5.1']);

// Pattern D: chat_template_kwargs.thinking + reasoning_effort (DeepSeek V4)
const dsV4Models = new Set([
  'deepseek-ai/deepseek-v4-flash',
  'deepseek-ai/deepseek-v4-pro',
]);

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

      const thinkingFlag =
        thinking?.type === 'enabled' ? true : thinking?.type === 'disabled' ? false : undefined;

      const shouldForceAssistantReasoningContent =
        thinkingFlag === true && typeof model === 'string' && forceReasoningModels.has(model);

      const processedMessages = messages?.map((message: any) => {
        if (message.role !== 'assistant') return message;

        const { reasoning, ...restMsg } = message;
        const reasoningContent =
          typeof restMsg.reasoning_content === 'string'
            ? restMsg.reasoning_content
            : typeof reasoning?.content === 'string'
              ? reasoning.content
              : undefined;

        if (shouldForceAssistantReasoningContent) {
          return { ...restMsg, reasoning_content: reasoningContent ?? '' };
        }

        if (reasoningContent !== undefined) {
          return { ...restMsg, reasoning_content: reasoningContent };
        }

        return restMsg;
      });

      const chatTemplateKwargs: Record<string, any> = {};

      // DeepSeek V4: reasoning_effort drives thinking + effort in kwargs
      // Template maps: "none" → {thinking:false}, "high"/"max" → {thinking:true, reasoning_effort}
      if (typeof model === 'string' && dsV4Models.has(model)) {
        if (reasoning_effort && reasoning_effort !== 'none') {
          chatTemplateKwargs.thinking = true;
          chatTemplateKwargs.reasoning_effort = reasoning_effort;
        } else if (reasoning_effort === 'none') {
          chatTemplateKwargs.thinking = false;
        } else if (thinkingFlag !== undefined) {
          chatTemplateKwargs.thinking = thinkingFlag;
        }
      } else if (thinkingFlag !== undefined) {
        if (preservedThinkingModels.has(model)) {
          chatTemplateKwargs.enable_thinking = thinkingFlag;
          chatTemplateKwargs.clear_thinking = false;
        } else if (enableThinkingModels.has(model)) {
          chatTemplateKwargs.enable_thinking = thinkingFlag;
        } else if (chatTemplateKwargsThinkingModels.has(model)) {
          chatTemplateKwargs.thinking = thinkingFlag;
        }
      }

      const result: any = {
        ...rest,
        model,
        messages: processedMessages,
      };

      if (Object.keys(chatTemplateKwargs).length > 0) {
        result.chat_template_kwargs = chatTemplateKwargs;
      }

      return result;
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
