import { ModelProvider } from 'model-bank';

import { type OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { type ChatCompletionErrorPayload } from '../../types';
import { AgentRuntimeErrorType } from '../../types/error';
import { processMultiProviderModelList } from '../../utils/modelParse';
import { createSiliconCloudImage } from './createImage';

export interface SiliconCloudModelCard {
  id: string;
}

export const params = {
  baseURL: 'https://api.siliconflow.cn/v1',
  chatCompletion: {
    handleError: (error: any): Omit<ChatCompletionErrorPayload, 'provider'> | undefined => {
      let errorResponse: Response | undefined;
      if (error instanceof Response) {
        errorResponse = error;
      } else if ('status' in (error as any)) {
        errorResponse = error as Response;
      }
      if (errorResponse) {
        if (errorResponse.status === 401) {
          return {
            error: errorResponse.status,
            errorType: AgentRuntimeErrorType.InvalidProviderAPIKey,
          };
        }

        if (errorResponse.status === 403) {
          return {
            error: errorResponse.status,
            errorType: AgentRuntimeErrorType.ProviderBizError,
            message:
              'Please check if the API Key balance is sufficient, or if you are using an unverified API Key to access models that require verification.',
          };
        }
      }
      return {
        error,
      };
    },
    handlePayload: (payload) => {
      const { max_tokens, model, thinking, messages, ...rest } = payload;
      const thinkingBudget =
        thinking?.budget_tokens === 0 ? 1 : thinking?.budget_tokens || undefined;

      const isThinkingEnabled = thinking?.type === 'enabled';

      // Process interleaved thinking - convert reasoning to reasoning_content
      const processedMessages = messages?.map((message: any) => {
        if (message.role === 'assistant' && message.reasoning?.content) {
          const { reasoning, ...restMessage } = message;
          return {
            ...restMessage,
            reasoning_content: reasoning.content,
          };
        }
        return message;
      });

      const result: any = {
        ...rest,
        max_tokens:
          max_tokens === undefined ? undefined : Math.min(Math.max(max_tokens, 1), 16_384),
        model,
        ...(processedMessages ? { messages: processedMessages } : {}),
      };

      if (thinking) {
        // Only some models support specifying enable_thinking, while other slow-thinking models only support adjusting thinking budget
        const hybridThinkingModels = [
          /GLM-4\.([5-7])(?!.*Air$)/, // GLM-4.5、GLM-4.6、GLM-4.7 和对应 V 版本（不包含 Air）
          /Qwen3-(?:\d+B|\d+B-A\d+B)$/, // Qwen3-8B、Qwen3-14B、Qwen3-32B、Qwen3-30B-A3B、Qwen3-235B-A22B
          /DeepSeek-V3\.[12]/, // DeepSeek-V3.1、DeepSeek-V3.2
          /Hunyuan-A13B-Instruct/,
          /moonshotai\/kimi-k2\.5/, // Kimi K2.5
        ];
        if (hybridThinkingModels.some((regexp) => regexp.test(model))) {
          result.enable_thinking = isThinkingEnabled;
        }
        if (typeof thinkingBudget !== 'undefined') {
          result.thinking_budget = Math.min(Math.max(thinkingBudget, 1), 32_768);
        }
      }
      return result;
    },
  },
  createImage: createSiliconCloudImage,
  debug: {
    chatCompletion: () => process.env.DEBUG_SILICONCLOUD_CHAT_COMPLETION === '1',
  },
  errorType: {
    bizError: AgentRuntimeErrorType.ProviderBizError,
    invalidAPIKey: AgentRuntimeErrorType.InvalidProviderAPIKey,
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList: SiliconCloudModelCard[] = modelsPage.data;

    return processMultiProviderModelList(modelList, 'siliconcloud');
  },
  provider: ModelProvider.SiliconCloud,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeSiliconCloudAI = createOpenAICompatibleRuntime(params);
