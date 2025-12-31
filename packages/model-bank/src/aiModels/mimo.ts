import { AIChatModelCard } from '../types/aiModel';

const mimoChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 200_000,
    description:
      'Xiaomi MiMo-V2-Flash is a 309B parameter Mixture-of-Experts model with 15B active parameters, delivering exceptional coding and reasoning capabilities at 150 tokens/second. Designed for Agent workflows with enterprise-grade performance.',
    displayName: 'MiMo-V2-Flash',
    enabled: true,
    id: 'mimo-v2-flash',
    maxOutput: 131_072,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.7, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.1, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-12-16',
    type: 'chat',
  },
];

export const allModels = [...mimoChatModels];

export default allModels;
