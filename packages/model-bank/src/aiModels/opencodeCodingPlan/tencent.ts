import { type AIChatModelCard } from '../../types/aiModel';

export const tencentChatModels: AIChatModelCard[] = [
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 256_000,
    description: 'Tencent Hy reasoning model for coding, instruction following, and agent tasks',
    displayName: 'Hy3',
    enabled: false,
    family: 'hunyuan',
    generation: 'hunyuan-3',
    id: 'hy3',
    maxOutput: 128_000,
    organization: 'Tencent',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.14, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.58, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.035, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-07-06',
    settings: { extendParams: ['hy3ReasoningEffort'] },
    sdkType: 'openai',
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 1_024_000,
    description:
      'A next-generation productivity model with significantly enhanced Agent and complex task execution capabilities.',
    displayName: 'Hy4 preview',
    enabled: false,
    family: 'hunyuan',
    generation: 'hunyuan-4',
    id: 'hy4-preview',
    maxOutput: 64_000,
    organization: 'Tencent',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.834, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.501, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.042, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-08-28',
    settings: { extendParams: ['reasoningEffort'] },
    sdkType: 'openai',
    type: 'chat',
  },
];

export default tencentChatModels;
