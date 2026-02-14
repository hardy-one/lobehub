import { ModelProvider } from 'model-bank';

import { type OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

// Models that support interleaved thinking format (reasoning -> reasoning_content)
const INTERLEAVED_THINKING_MODELS = new Set([
  'deepseek-ai/deepseek-v3.1',
  'deepseek-ai/deepseek-v3.1-terminus',
  'deepseek-ai/deepseek-v3.2',
  'z-ai/glm4.7',
  'z-ai/glm5',
  'moonshotai/kimi-k2.5',
  'minimaxai/minimax-m2',
  'minimaxai/minimax-m2.1',
]);

export interface NvidiaModelCard {
  id: string;
}

export const params = {
  baseURL: 'https://integrate.api.nvidia.com/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const { model, thinking, messages, ...rest } = payload;

      // Convert thinking.type to boolean for API
      const thinkingFlag =
        thinking?.type === 'enabled' ? true : thinking?.type === 'disabled' ? false : undefined;

      // Process interleaved thinking - convert reasoning to reasoning_content
      // Only for models that support interleaved thinking format
      const processedMessages = INTERLEAVED_THINKING_MODELS.has(model)
        ? messages?.map((message: any) => {
            if (message.role === 'assistant' && message.reasoning?.content) {
              const { reasoning, ...restMessage } = message;
              return {
                ...restMessage,
                reasoning_content: reasoning.content,
              };
            }
            return message;
          })
        : messages;

      return {
        ...rest,
        model,
        ...(processedMessages ? { messages: processedMessages } : {}),
        // Send chat_template_kwargs based on thinking parameter
        ...(thinkingFlag !== undefined
          ? {
              chat_template_kwargs: { thinking: thinkingFlag },
            }
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
