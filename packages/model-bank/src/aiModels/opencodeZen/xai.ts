import { type AIChatModelCard } from '../../types/aiModel';

export const xaiChatModels: AIChatModelCard[] = [
  {
    abilities: { functionCall: true, reasoning: true, structuredOutput: true, vision: true },
    contextWindowTokens: 500_000,
    description: "xAI's Grok model for chat, coding, agentic tools, and lower hallucination risk",
    displayName: 'Grok 4.5',
    enabled: false,
    family: 'grok',
    generation: 'grok-4.5',
    id: 'grok-4.5',
    maxOutput: 500_000,
    organization: 'xAI',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-07-08',
    settings: { extendParams: ['grok4_5ReasoningEffort'] },
    sdkType: 'openai-responses',
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, structuredOutput: true, vision: true },
    contextWindowTokens: 500_000,
    description:
      "xAI's frontier model for long-running agents, coding, knowledge work, and visual projects",
    displayName: 'Grok 4.6',
    enabled: false,
    family: 'grok',
    generation: 'grok-4.6',
    id: 'grok-4.6',
    knowledgeCutoff: '2026-02-01',
    maxOutput: 500_000,
    organization: 'xAI',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-08-12',
    settings: { extendParams: ['grok4_6ReasoningEffort'] },
    sdkType: 'openai-responses',
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, structuredOutput: true, vision: true },
    contextWindowTokens: 500_000,
    description:
      "xAI's frontier model for long-running agents, coding, knowledge work, and visual projects",
    displayName: 'Grok 4.7',
    enabled: false,
    family: 'grok',
    generation: 'grok-4.7',
    id: 'grok-4.7',
    knowledgeCutoff: '2026-05',
    maxOutput: 500_000,
    organization: 'xAI',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-09-21',
    settings: { extendParams: ['grok4_7ReasoningEffort'] },
    sdkType: 'openai-responses',
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, structuredOutput: true, vision: true },
    contextWindowTokens: 256_000,
    description: 'Fast Grok coding model tuned for agentic engineering and iterative edits',
    displayName: 'Grok Build 0.1',
    enabled: false,
    family: 'grok-build',
    id: 'grok-build-0.1',
    maxOutput: 256_000,
    organization: 'xAI',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-16',
    sdkType: 'openai-responses',
    type: 'chat',
  },
];

export default xaiChatModels;
