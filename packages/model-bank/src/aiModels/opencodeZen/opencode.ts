import { type AIChatModelCard } from '../../types/aiModel';

export const opencodeChatModels: AIChatModelCard[] = [
  {
    abilities: { functionCall: true, reasoning: true, structuredOutput: true },
    contextWindowTokens: 200_000,
    description:
      'Reasoning model for deliberate analysis, multi-step problem solving, and tool use',
    displayName: 'Big Pickle',
    enabled: true,
    family: 'big-pickle',
    id: 'big-pickle',
    knowledgeCutoff: '2025-01',
    maxOutput: 32_000,
    organization: 'OpenCode',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-10-17',
    sdkType: 'openai',
    type: 'chat',
  },
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
    abilities: { functionCall: true, reasoning: true, structuredOutput: true },
    contextWindowTokens: 262_144,
    description: 'Best in class local model',
    displayName: 'LL Alpha Free',
    enabled: false,
    id: 'll-alpha-free',
    knowledgeCutoff: '2026-06',
    maxOutput: 65_536,
    organization: 'OpenCode',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-10-15',
    settings: { extendParams: ['opus47Effort'] },
    sdkType: 'openai',
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, video: true, vision: true },
    contextWindowTokens: 1_048_576,
    description:
      'Anonymous preview reasoning model for coding, agentic tasks, tool use, and multimodal input',
    displayName: 'Space Bunny Free',
    enabled: false,
    family: 'space-bunny',
    id: 'space-bunny-free',
    maxOutput: 524_288,
    organization: 'OpenCode',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
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
