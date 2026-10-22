import { type AIChatModelCard } from '../../types/aiModel';

export const googleChatModels: AIChatModelCard[] = [
  {
    abilities: {
      audio: true,
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      "Google's flagship reasoning model for complex software engineering, deep math and science, and long-horizon autonomous agents",
    displayName: 'Gemini 4 Argon Contributor',
    enabled: false,
    family: 'gemini',
    id: 'gemini-4-argon-contributor',
    knowledgeCutoff: '2026-03',
    maxOutput: 65_536,
    organization: 'Google',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-10-13',
    settings: { extendParams: ['reasoningEffort'] },
    sdkType: 'google',
    type: 'chat',
  },
];

export default googleChatModels;
