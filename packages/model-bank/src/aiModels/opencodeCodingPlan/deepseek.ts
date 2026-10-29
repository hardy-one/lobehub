import { type AIChatModelCard } from '../../types/aiModel';

export const deepseekChatModels: AIChatModelCard[] = [
  {
    abilities: { functionCall: true, reasoning: true, structuredOutput: true },
    contextWindowTokens: 1_000_000,
    description: 'Flagship DeepSeek model for coding, reasoning, and agentic work',
    displayName: 'DeepSeek V4 Pro (New)',
    enabled: true,
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'deepseek-v4-pro',
    knowledgeCutoff: '2025-05',
    maxOutput: 384_000,
    organization: 'DeepSeek',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.66, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.98, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.022, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-24',
    settings: { extendParams: ['deepseekV4ReasoningEffort'] },
    sdkType: 'openai',
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, structuredOutput: true, vision: true },
    contextWindowTokens: 1_000_000,
    description: 'DeepSeek V4.1 Flash model for reasoning and agentic coding',
    displayName: 'DeepSeek V4.1 Flash',
    enabled: false,
    family: 'deepseek',
    generation: 'deepseek-v4.1',
    id: 'deepseek-v4.1-flash',
    knowledgeCutoff: '2025-05',
    maxOutput: 384_000,
    organization: 'DeepSeek',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.003, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-09-10',
    settings: { extendParams: ['deepseekV4ReasoningEffort'] },
    sdkType: 'openai',
    type: 'chat',
  },
];

export default deepseekChatModels;
