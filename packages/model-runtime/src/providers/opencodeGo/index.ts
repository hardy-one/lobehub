import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import type { ChatCompletionErrorPayload } from '../../types';
import { AgentRuntimeErrorType } from '../../types/error';
import { processMultiProviderModelList } from '../../utils/modelParse';

export const params = {
  baseURL: 'https://opencode.ai/zen/go/v1',
  chatCompletion: {
    handleError: (error: any): Omit<ChatCompletionErrorPayload, 'provider'> | undefined => {
      const status = error?.status;

      if (status === 401) {
        return {
          error,
          errorType: AgentRuntimeErrorType.InvalidProviderAPIKey,
        };
      }

      if (status === 402) {
        return {
          error,
          errorType: AgentRuntimeErrorType.InsufficientQuota,
        };
      }

      if (status === 429) {
        return {
          error,
          errorType: AgentRuntimeErrorType.ProviderBizError,
          message: 'Request rate limit exceeded. Please try again later.',
        };
      }

      if (error?.error || error?.code || error?.message) {
        const errorData = error?.error?.error || error?.error || error;
        const { code, message } = errorData;

        if (code || message) {
          return {
            error: errorData,
          };
        }
      }

      return {
        error,
      };
    },
    handlePayload: (payload) => {
      const { enabledSearch, model, thinking, ...rest } = payload;

      return {
        ...rest,
        model,
        stream: true,
        ...(payload.tools && {
          parallel_tool_calls: true,
        }),
      } as any;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_OPENCODE_GO_CHAT_COMPLETION === '1',
  },
  errorType: {
    bizError: AgentRuntimeErrorType.ProviderBizError,
    invalidAPIKey: AgentRuntimeErrorType.InvalidProviderAPIKey,
  },
  models: async () => {
    const { opencodego } = await import('model-bank');
    return processMultiProviderModelList(
      opencodego.map((m: { id: string }) => ({ id: m.id })),
      'opencodego',
    );
  },
  provider: ModelProvider.OpenCodeGo,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeOpenCodeGoAI = createOpenAICompatibleRuntime(params);
