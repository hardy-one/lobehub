import { type AIChatModelCard } from '../../types/aiModel';

export const metaChatModels: AIChatModelCard[] = [
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
      'Muse Spark 1.2 is a coding-focused update to Muse Spark 1.1 with improvements in code generation, complex debugging, codebase understanding, and end-to-end developer workflows.',
    displayName: 'Muse Spark 1.2',
    enabled: false,
    family: 'muse',
    id: 'muse-spark-1.2',
    maxOutput: 131_072,
    organization: 'Meta',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-08-05',
    settings: { extendParams: ['gpt5_2ReasoningEffort'] },
    sdkType: 'openai-responses',
    type: 'chat',
  },
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
      'Muse Spark 1.2 is a coding-focused update to Muse Spark 1.1 with improvements in code generation, complex debugging, codebase understanding, and end-to-end developer workflows.',
    displayName: 'Muse Spark 1.2 Free',
    enabled: false,
    family: 'muse-free',
    id: 'muse-spark-1.2-contributor-free',
    maxOutput: 131_072,
    organization: 'Meta',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-08-05',
    settings: { extendParams: ['gpt5_2ReasoningEffort'] },
    sdkType: 'openai-responses',
    type: 'chat',
  },
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
      'Muse Spark 1.3 is a multimodal reasoning model from Meta for long-running agentic, multi-agent, and coding workflows. It improves long-horizon agent collaboration, instruction following, and coding efficiency relative to Muse Spark 1.2.',
    displayName: 'Muse Spark 1.3',
    enabled: false,
    family: 'muse',
    id: 'muse-spark-1.3',
    maxOutput: 131_072,
    organization: 'Meta',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-09-02',
    settings: { extendParams: ['gpt5_2ReasoningEffort'] },
    sdkType: 'openai-responses',
    type: 'chat',
  },
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
      'Muse Spark 1.3 is a multimodal reasoning model from Meta for coding and agentic workflows.',
    displayName: 'Muse Spark 1.3 Free',
    enabled: false,
    family: 'muse-free',
    id: 'muse-spark-1.3-contributor-free',
    maxOutput: 131_072,
    organization: 'Meta',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-09-02',
    settings: { extendParams: ['gpt5_2ReasoningEffort'] },
    sdkType: 'openai-responses',
    type: 'chat',
  },
];

export default metaChatModels;
