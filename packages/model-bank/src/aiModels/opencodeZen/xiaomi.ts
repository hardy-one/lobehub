import { type AIChatModelCard } from '../../types/aiModel';

export const xiaomiChatModels: AIChatModelCard[] = [
  {
    abilities: { audio: true, functionCall: true, reasoning: true, video: true, vision: true },
    contextWindowTokens: 200_000,
    description: 'MiMo Flash model for multimodal coding agents and long-context automation',
    displayName: 'MiMo-V2.6-Flash Free',
    enabled: false,
    family: 'mimo',
    id: 'mimo-v2.6-flash-free',
    maxOutput: 32_000,
    organization: 'Xiaomi',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-09-22',
    settings: { extendParams: ['mimoReasoningEffort'] },
    sdkType: 'openai',
    type: 'chat',
  },
];

export default xiaomiChatModels;
