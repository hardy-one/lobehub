import { type AIChatModelCard } from '../../types/aiModel';

export const stepfunChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      "StepFun's next-generation flagship base model for coding and professional knowledge work, with native text, image, and video input and a 1M-token context window",
    displayName: 'Step 5 Preview',
    enabled: false,
    id: 'step-5-preview',
    maxOutput: 65_536,
    organization: 'StepFun',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.7, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-09-16',
    settings: { extendParams: ['reasoningEffort'] },
    sdkType: 'openai',
    type: 'chat',
  },
];

export default stepfunChatModels;
