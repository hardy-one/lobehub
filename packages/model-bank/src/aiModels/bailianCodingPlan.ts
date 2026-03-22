import { type AIChatModelCard } from '../types/aiModel';

// https://help.aliyun.com/zh/model-studio/coding-plan-overview

const bailianCodingPlanChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'Qwen3.5 Plus supports text, image, and video input. Optimized for coding tasks with strong multimodal capabilities.',
    displayName: 'Qwen3.5 Plus',
    id: 'qwen3.5-plus',
    maxOutput: 65_536,
    organization: 'Qwen',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'Qwen3 Coder Plus: Strong coding-agent abilities, tool use, and environment interaction for autonomous programming.',
    displayName: 'Qwen3 Coder Plus',
    id: 'qwen3-coder-plus',
    maxOutput: 65_536,
    organization: 'Qwen',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Qwen3 Max: Best-performing Qwen model for complex, multi-step coding tasks with thinking support.',
    displayName: 'Qwen3 Max',
    id: 'qwen3-max-2026-01-23',
    maxOutput: 65_536,
    organization: 'Qwen',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Qwen3 Coder Next: Next-gen coder optimized for complex multi-file code generation, debugging, and agent workflows.',
    displayName: 'Qwen3 Coder Next',
    id: 'qwen3-coder-next',
    maxOutput: 65_536,
    organization: 'Qwen',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 202_752,
    description:
      'GLM-5: Hybrid reasoning model from Zhipu AI built for agents, with thinking and non-thinking modes.',
    displayName: 'GLM-5',
    id: 'glm-5',
    maxOutput: 16_384,
    organization: 'Zhipu',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 202_752,
    description:
      'GLM-4.7: Hybrid reasoning model from Zhipu AI built for agents, with thinking and non-thinking modes.',
    displayName: 'GLM-4.7',
    id: 'glm-4.7',
    maxOutput: 16_384,
    organization: 'Zhipu',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Kimi K2.5: Most capable Kimi model, delivering open-source SOTA in agent tasks, coding, and vision understanding.',
    displayName: 'Kimi K2.5',
    id: 'kimi-k2.5',
    maxOutput: 32_768,
    organization: 'Moonshot',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
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
      'MiniMax-M2.5: Flagship open-source large model from MiniMax, focusing on solving complex real-world tasks.',
    displayName: 'MiniMax-M2.5',
    id: 'MiniMax-M2.5',
    maxOutput: 131_072,
    organization: 'MiniMax',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
];

export default bailianCodingPlanChatModels;
