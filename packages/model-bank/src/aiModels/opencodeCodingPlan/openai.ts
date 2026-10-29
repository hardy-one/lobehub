import { type AIChatModelCard } from '../../types/aiModel';

export const openaiChatModels: AIChatModelCard[] = [
  {
    abilities: { functionCall: true, reasoning: true, structuredOutput: true, vision: true },
    contextWindowTokens: 1_050_000,
    description: 'Cost-efficient GPT-5.6 model for fast, high-volume workloads',
    displayName: 'GPT-5.6 Luna',
    enabled: false,
    family: 'gpt',
    generation: 'gpt-5.6',
    id: 'gpt-5.6-luna',
    knowledgeCutoff: '2026-02-16',
    maxOutput: 128_000,
    organization: 'OpenAI',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.02, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-07-09',
    settings: { extendParams: ['gpt5_6ReasoningEffort'] },
    sdkType: 'openai-responses',
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, structuredOutput: true, vision: true },
    contextWindowTokens: 1_050_000,
    description: "OpenAI's most efficient model for focused, high-volume tasks",
    displayName: 'GPT-6 Luna',
    enabled: false,
    family: 'gpt',
    generation: 'gpt-6',
    id: 'gpt-6-luna',
    knowledgeCutoff: '2026-05-18',
    maxOutput: 128_000,
    organization: 'OpenAI',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.01, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 0.125, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-09-22',
    settings: { extendParams: ['gpt6ReasoningEffort'] },
    sdkType: 'openai-responses',
    type: 'chat',
  },
];

export default openaiChatModels;
