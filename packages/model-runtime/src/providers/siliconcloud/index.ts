import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
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
              '请检查 API Key 余额是否充足,或者是否在用未实名的 API Key 访问需要实名的模型。',
          };
        }
      }

      if (error?.error || error?.code || error?.message) {
        // Prioritize nested error structure, then fall back to top-level fields
        const errorData = error?.error?.error || error?.error || error;
        const { code, message, data } = errorData;

        if (code || message || data) {
          return {
            error,
          };
        }
      }
      return {
        error,
      };
    },
    handlePayload: (payload) => {
      const { max_tokens, model, thinking, messages, ...rest } = payload;

      // Format conversion: reasoning → reasoning_content
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
        messages: processedMessages,
      };

      // Format conversion: thinking → enable_thinking + thinking_budget
      // Pure format conversion, API decides if parameters are supported
      if (thinking) {
        result.enable_thinking = thinking.type === 'enabled';
        if (thinking.budget_tokens) {
          result.thinking_budget = Math.min(Math.max(thinking.budget_tokens, 1), 32_768);
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
