import { type AIChatModelCard } from '../../types/aiModel';

export const anthropicChatModels: AIChatModelCard[] = [
  {
    abilities: { functionCall: true, reasoning: true, structuredOutput: true, vision: true },
    contextWindowTokens: 1_000_000,
    description:
      'Fast Claude model for responsive assistance, classification, and lightweight agents',
    displayName: 'Claude Haiku 5.5',
    enabled: false,
    family: 'claude-haiku',
    generation: 'claude-5.5',
    id: 'claude-haiku-5-5',
    knowledgeCutoff: '2026-06',
    maxOutput: 128_000,
    organization: 'Anthropic',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.01, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 0.125, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-10-07',
    settings: { extendParams: ['enableReasoning', 'reasoningEffort'] },
    sdkType: 'anthropic',
    type: 'chat',
  },
];

export default anthropicChatModels;
