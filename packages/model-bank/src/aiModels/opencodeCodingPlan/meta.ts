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
    displayName: 'Muse Spark 1.2 Contributor',
    enabled: false,
    family: 'muse',
    generation: 'muse-spark-1.2',
    id: 'muse-spark-1.2-contributor',
    maxOutput: 131_072,
    organization: 'Meta',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.002, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-08-05',
    settings: { extendParams: ['reasoningEffort'] },
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
    displayName: 'Muse Spark 1.3 Contributor',
    enabled: true,
    family: 'muse',
    generation: 'muse-spark-1.3',
    id: 'muse-spark-1.3-contributor',
    maxOutput: 131_072,
    organization: 'Meta',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.002, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-09-02',
    settings: { extendParams: ['reasoningEffort'] },
    sdkType: 'openai-responses',
    type: 'chat',
  },
];

export default metaChatModels;
