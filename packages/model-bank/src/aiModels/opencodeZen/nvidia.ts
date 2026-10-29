import { type AIChatModelCard } from '../../types/aiModel';

export const nvidiaChatModels: AIChatModelCard[] = [
  {
    abilities: { functionCall: true, reasoning: true, structuredOutput: true },
    contextWindowTokens: 262_144,
    description: 'Fast NVIDIA Nemotron MoE for reliable agentic tasks across enterprise workloads',
    displayName: 'Nemotron 3.5 Lightning Free',
    enabled: false,
    family: 'nemotron-free',
    id: 'nemotron-3.5-lightning-free',
    maxOutput: 262_144,
    organization: 'Nvidia',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-08-11',
    sdkType: 'openai',
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 1_048_576,
    description:
      'NVIDIA vision-language reasoning model for text, image, and video understanding and agentic tool use',
    displayName: 'Nemotron 3.5 Super VL Free',
    enabled: false,
    family: 'nemotron-free',
    id: 'nemotron-3.5-super-vl-free',
    maxOutput: 131_072,
    organization: 'Nvidia',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-10-15',
    settings: { extendParams: ['gpt5_2ReasoningEffort'] },
    sdkType: 'openai',
    type: 'chat',
  },
];

export default nvidiaChatModels;
