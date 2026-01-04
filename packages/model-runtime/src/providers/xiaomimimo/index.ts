import { ModelProvider } from 'model-bank';

import {
  type OpenAICompatibleFactoryOptions,
  createOpenAICompatibleRuntime,
} from '../../core/openaiCompatibleFactory';
import { MODEL_LIST_CONFIGS, processModelList } from '../../utils/modelParse';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export interface XiaomiMiMoModelCard {
  id: string;
}

export const params = {
  baseURL: 'https://api.xiaomimimo.com/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const { thinking, temperature, top_p, max_tokens, stream, tools, ...rest } = payload as any;
      const hasTools = tools && tools.length > 0;

      // When tools are present, automatically disable thinking to avoid unstable output
      // See: https://platform.xiaomimimo.com/docs for model recommendations
      const thinkingType = hasTools ? 'disabled' : thinking?.type;

      return {
        ...rest,
        max_completion_tokens: max_tokens,
        stream: stream ?? true,
        tools,
        ...(typeof temperature === 'number'
          ? { temperature: clamp(temperature, 0, 1.5) }
          : undefined),
        ...(typeof top_p === 'number' ? { top_p: clamp(top_p, 0.01, 1) } : undefined),
        ...(thinkingType === 'enabled' || thinkingType === 'disabled'
          ? { thinking: { type: thinkingType } }
          : undefined),
      } as any;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_XIAOMIMIMO_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList: XiaomiMiMoModelCard[] = modelsPage.data;

    return processModelList(modelList, MODEL_LIST_CONFIGS.xiaomimimo, 'xiaomimimo');
  },
  provider: ModelProvider.XiaomiMiMo,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeXiaomiMiMoAI = createOpenAICompatibleRuntime(params);
