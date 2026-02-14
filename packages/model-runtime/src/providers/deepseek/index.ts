import { ModelProvider } from 'model-bank';

import { type OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { MODEL_LIST_CONFIGS, processModelList } from '../../utils/modelParse';

export interface DeepSeekModelCard {
  id: string;
}

export const params = {
  baseURL: 'https://api.deepseek.com/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      // Transform reasoning object to reasoning_content string for multi-turn conversations
      // DeepSeek Reasoner API requires all assistant messages to have reasoning_content field
      const messages = payload.messages.map((message: any) => {
        // If message is assistant role with reasoning.content, convert it
        if (message.role === 'assistant' && message.reasoning?.content) {
          const { reasoning, ...rest } = message;
          return {
            ...rest,
            reasoning_content: reasoning.content,
          };
        }

        // For assistant messages, ensure reasoning_content exists (required by DeepSeek Reasoner API)
        if (message.role === 'assistant') {
          const { reasoning, ...rest } = message;
          return {
            ...rest,
            reasoning_content: '',
          };
        }

        // For non-assistant messages, just remove reasoning field if present
        const msg = { ...message };
        delete msg.reasoning;
        return msg;
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
