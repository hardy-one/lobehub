import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

export const params = {
  baseURL: 'https://opencode.ai/zen/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const { reasoning_effort, thinking, reasoning, ...rest } = payload;

      const finalReasoning = {
        ...reasoning,
        ...(reasoning_effort && { effort: reasoning_effort }),
        ...(thinking?.budget_tokens && { max_tokens: thinking.budget_tokens }),
        ...(thinking?.type === 'enabled' && { enabled: true }),
        ...(thinking?.type === 'disabled' && { enabled: false }),
      };

      const hasReasoning = Object.keys(finalReasoning).length > 0;

      return {
        ...rest,
        ...(hasReasoning && { reasoning: finalReasoning }),
      } as any;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_OPENCODE_ZEN_CHAT_COMPLETION === '1',
  },
  models: async ({ client: openAIClient }) => {
    const modelsPage = (await openAIClient.models.list()) as any;
    const modelList = modelsPage.data || [];
    return processMultiProviderModelList(modelList, 'opencodezen');
  },
  provider: ModelProvider.OpenCodeZen,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeOpenCodeZenAI = createOpenAICompatibleRuntime(params);
