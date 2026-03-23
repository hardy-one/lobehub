import { type AIChatModelCard } from '../types/aiModel';

// ref: https://www.volcengine.com/docs/82379/1925114

const volcengineCodingPlanChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      video: true,
      vision: true,
    },
    config: {
      deploymentName: 'doubao-seed-code-preview-251028',
    },
    contextWindowTokens: 256_000,
    description:
      'Doubao-Seed-Code is deeply optimized for agentic coding, supports multimodal inputs (text/image/video) and a 256k context window, is compatible with the Anthropic API, and fits coding, vision understanding, and agent workflows.',
    displayName: 'Doubao Seed Code',
    enabled: true,
    id: 'doubao-seed-code',
    maxOutput: 32_000,
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 1.2,
              '[0.032, 0.128]': 1.4,
              '[0.128, 0.256]': 2.8,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textInput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.032]': 8,
              '[0.032, 0.128]': 12,
              '[0.128, 0.256]': 16,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        { name: 'textInput_cacheRead', rate: 0.24, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 0.017, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-10-28',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      video: true,
      vision: true,
    },
    config: {
      deploymentName: 'doubao-seed-2-0-code-preview-260215',
    },
    contextWindowTokens: 256_000,
    description:
      'Doubao-Seed-2.0-code is deeply optimized for agentic coding, supports multimodal inputs and a 256k context window, fitting coding, vision understanding, and agent workflows.',
    displayName: 'Doubao Seed 2.0 Code',
    enabled: true,
    id: 'doubao-seed-2.0-code',
    maxOutput: 128_000,
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 3.2,
              '[0.032, 0.128]': 4.8,
              '[0.128, 0.256]': 9.6,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textInput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.032]': 16,
              '[0.032, 0.128]': 24,
              '[0.128, 0.256]': 48,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        { name: 'textInput_cacheRead', rate: 0.64, strategy: 'fixed', unit: 'millionTokens' },
        {
          lookup: { prices: { '1h': 0.017 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-02-15',
    settings: {
      extendParams: ['gpt5ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      video: true,
      vision: true,
    },
    config: {
      deploymentName: 'doubao-seed-2-0-pro-260215',
    },
    contextWindowTokens: 256_000,
    description:
      "Doubao-Seed-2.0-pro is ByteDance's flagship Agent general model, with all-around leaps in complex task planning and execution capabilities.",
    displayName: 'Doubao Seed 2.0 Pro',
    enabled: true,
    id: 'doubao-seed-2.0-pro',
    maxOutput: 128_000,
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 3.2,
              '[0.032, 0.128]': 4.8,
              '[0.128, 0.256]': 9.6,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textInput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.032]': 16,
              '[0.032, 0.128]': 24,
              '[0.128, 0.256]': 48,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        { name: 'textInput_cacheRead', rate: 0.64, strategy: 'fixed', unit: 'millionTokens' },
        {
          lookup: { prices: { '1h': 0.017 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-02-15',
    settings: {
      extendParams: ['gpt5ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      video: true,
      vision: true,
    },
    config: {
      deploymentName: 'doubao-seed-2-0-lite-260215',
    },
    contextWindowTokens: 256_000,
    description:
      'Doubao-Seed-2.0-lite is a new multimodal deep-reasoning model that delivers better value and a strong choice for common tasks, with a context window up to 256k.',
    displayName: 'Doubao Seed 2.0 Lite',
    enabled: true,
    id: 'doubao-seed-2.0-lite',
    maxOutput: 128_000,
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 0.6,
              '[0.032, 0.128]': 0.9,
              '[0.128, 0.256]': 1.8,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textInput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.032]': 3.6,
              '[0.032, 0.128]': 5.4,
              '[0.128, 0.256]': 10.8,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        { name: 'textInput_cacheRead', rate: 0.12, strategy: 'fixed', unit: 'millionTokens' },
        {
          lookup: { prices: { '1h': 0.017 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-02-15',
    settings: {
      extendParams: ['gpt5ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 204_800,
    description:
      'MiniMax-M2.5 is a flagship open-source large model from MiniMax, focusing on solving complex real-world tasks. Its core strengths are multi-language programming capabilities and the ability to solve complex tasks as an Agent.',
    displayName: 'MiniMax M2.5',
    enabled: true,
    id: 'MiniMax-M2.5',
    maxOutput: 131_072,
    organization: 'MiniMax',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 200_000,
    description:
      "GLM-4.7 is Zhipu's latest flagship model, enhanced for Agentic Coding scenarios with improved coding capabilities, long-term task planning, and tool collaboration.",
    displayName: 'GLM-4.7',
    enabled: true,
    id: 'glm-4.7',
    maxOutput: 131_072,
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 262_144,
    description:
      "DeepSeek-V3.2 is DeepSeek's latest coding model with strong reasoning capabilities.",
    displayName: 'DeepSeek-V3.2',
    enabled: true,
    id: 'deepseek-v3.2',
    maxOutput: 65_536,
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      "Kimi K2.5 is Kimi's most versatile model to date, featuring a native multimodal architecture that supports both vision and text inputs, 'thinking' and 'non-thinking' modes, and both conversational and agent tasks.",
    displayName: 'Kimi K2.5',
    enabled: true,
    id: 'kimi-k2.5',
    maxOutput: 32_768,
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
];

export default volcengineCodingPlanChatModels;
