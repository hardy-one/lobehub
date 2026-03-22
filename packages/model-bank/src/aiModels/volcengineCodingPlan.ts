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
    contextWindowTokens: 256_000,
    description:
      'Doubao-Seed-Code is deeply optimized for agentic coding, supports multimodal inputs (text/image/video) and a 256k context window, is compatible with the Anthropic API, and fits coding, vision understanding, and agent workflows.',
    displayName: 'Doubao Seed Code',
    enabled: true,
    id: 'doubao-seed-code',
    maxOutput: 32_000,
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
    contextWindowTokens: 256_000,
    description:
      "Doubao-Seed-Code-2.0 is ByteDance's next generation coding model with enhanced agentic capabilities and multimodal understanding.",
    displayName: 'Doubao Seed Code 2.0',
    enabled: true,
    id: 'doubao-seed-code-2.0',
    maxOutput: 32_000,
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
