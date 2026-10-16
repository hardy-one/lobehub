import { type AIChatModelCard } from '../../types/aiModel';

export const opencodeChatModels: AIChatModelCard[] = [
  {
    abilities: { functionCall: true, reasoning: true, structuredOutput: true },
    contextWindowTokens: 1_048_576,
    description:
      'A text-only reasoning model for coding and agentic workflows, with tool calling and structured JSON outputs.',
    displayName: 'Cat Jam Free',
    enabled: false,
    id: 'cat-jam-free',
    maxOutput: 131_072,
    organization: 'OpenCode',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-10-12',
    settings: { extendParams: ['opus47Effort'] },
    sdkType: 'openai',
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, video: true, vision: true },
    contextWindowTokens: 1_048_576,
    description:
      'Anonymous preview reasoning model for coding, agentic tasks, tool use, and multimodal input',
    displayName: 'Space Bunny',
    enabled: false,
    family: 'space-bunny',
    id: 'space-bunny',
    maxOutput: 524_288,
    organization: 'OpenCode',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.03, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-09-23',
    settings: { extendParams: ['reasoningEffort'] },
    sdkType: 'openai',
    type: 'chat',
  },
];

export default opencodeChatModels;
