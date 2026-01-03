import { ModelProvider } from 'model-bank';

import {
  type OpenAICompatibleFactoryOptions,
  createOpenAICompatibleRuntime,
} from '../../core/openaiCompatibleFactory';
import { MODEL_LIST_CONFIGS, processModelList } from '../../utils/modelParse';

export interface DeepSeekModelCard {
  id: string;
}

export const params = {
  baseURL: 'https://api.deepseek.com/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      // Check if this is a reasoning model (deepseek-reasoner, deepseek-r1, etc.)
      const isReasoningModel = /reasoner|r1/i.test(payload.model || '');

      // Transform reasoning object to reasoning_content string for multi-turn conversations
      const messages = payload.messages.map((message: any) => {
        // Only transform if message has reasoning.content
        if (message.reasoning?.content) {
          const { reasoning, ...rest } = message;
          return {
            ...rest,
            reasoning_content: reasoning.content,
          };
        }

        // Remove reasoning field if present (without content)
        const messageWithoutReasoning =
          'reasoning' in message
            ? Object.fromEntries(Object.entries(message).filter(([key]) => key !== 'reasoning'))
            : message;

        // For reasoning models, ensure all assistant messages have reasoning_content field
        // to comply with DeepSeek API requirement for multi-turn conversations with tool calls
        // Ref: https://api-docs.deepseek.com/guides/thinking_mode#tool-calls
        if (isReasoningModel && message.role === 'assistant' && !('reasoning_content' in message)) {
          return {
            ...messageWithoutReasoning,
            reasoning_content: '',
          };
        }

        return messageWithoutReasoning;
      });

      return {
        ...payload,
        messages,
        stream: payload.stream ?? true,
      } as any;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_DEEPSEEK_CHAT_COMPLETION === '1',
  },
  // Deepseek don't support json format well
  // use Tools calling to simulate
  generateObject: {
    useToolsCalling: true,
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList: DeepSeekModelCard[] = modelsPage.data;

    return processModelList(modelList, MODEL_LIST_CONFIGS.deepseek, 'deepseek');
  },
  provider: ModelProvider.DeepSeek,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeDeepSeekAI = createOpenAICompatibleRuntime(params);
