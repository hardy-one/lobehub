import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

export const LobeStepFunCodingPlanAI = createOpenAICompatibleRuntime({
  baseURL: 'https://api.stepfun.com/step_plan/v1',
  chatCompletion: {
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
    chatCompletion: () => process.env.DEBUG_STEPFUN_CODING_PLAN_CHAT_COMPLETION === '1',
  },
  models: async () => {
    const { stepfuncodingplan } = await import('model-bank');
    return processMultiProviderModelList(
      stepfuncodingplan.map((m: { id: string }) => ({ id: m.id })),
      'stepfuncodingplan',
    );
  },
  provider: ModelProvider.StepFunCodingPlan,
});
