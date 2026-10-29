import { type AIChatModelCard } from '../../types/aiModel';

export const mistralChatModels: AIChatModelCard[] = [
  {
    abilities: { functionCall: true, reasoning: true, structuredOutput: true, vision: true },
    contextWindowTokens: 524_288,
    description: "Mistral's 1T-parameter multimodal MoE for reasoning, coding, and agentic work",
    displayName: 'Mistral Large 4',
    enabled: false,
    family: 'mistral-large',
    id: 'mistral-large-4',
    maxOutput: 262_144,
    organization: 'Mistral',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.68, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.09, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.07, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-10-06',
    settings: { extendParams: ['deepseekV4ReasoningEffort'] },
    sdkType: 'openai',
    type: 'chat',
  },
];

export default mistralChatModels;
