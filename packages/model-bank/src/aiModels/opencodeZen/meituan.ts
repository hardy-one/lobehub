import { type AIChatModelCard } from '../../types/aiModel';

export const meituanChatModels: AIChatModelCard[] = [
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 1_000_000,
    description:
      "Meituan's multimodal reasoning model for coding and agent tasks, with image understanding and a 1M-token context window",
    displayName: 'LongCat 2.5 Preview Free',
    enabled: false,
    family: 'longcat',
    generation: 'longcat-2.5',
    id: 'longcat-2.5-preview-free',
    maxOutput: 131_072,
    organization: 'Meituan',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-09-25',
    settings: { extendParams: ['enableReasoning'] },
    sdkType: 'openai',
    type: 'chat',
  },
];

export default meituanChatModels;
