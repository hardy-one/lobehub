import { type AIChatModelCard } from '../types/aiModel';

// ref: https://www.volcengine.com/docs/82379/1925114

const volcengineCodingPlanChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 262_144,
    description:
      "Doubao-Seed-Code: ByteDance's latest coding model with strong agentic capabilities.",
    displayName: 'Doubao-Seed-Code',
    id: 'doubao-seed-code',
    maxOutput: 65_536,
    organization: 'ByteDance',
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
    contextWindowTokens: 262_144,
    description: 'Doubao-Seed-Code-2.0: Next generation coding model from ByteDance.',
    displayName: 'Doubao-Seed-Code-2.0',
    id: 'doubao-seed-code-2.0',
    maxOutput: 65_536,
    organization: 'ByteDance',
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
    description: "GLM-4.7: Zhipu AI's flagship model for coding.",
    displayName: 'GLM-4.7',
    id: 'glm-4.7',
    maxOutput: 65_536,
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
    contextWindowTokens: 262_144,
    description: "DeepSeek-V3.2: DeepSeek's latest coding model.",
    displayName: 'DeepSeek-V3.2',
    id: 'deepseek-v3.2',
    maxOutput: 65_536,
    organization: 'DeepSeek',
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
    contextWindowTokens: 262_144,
    description: "Kimi-K2.5: Moonshot AI's most intelligent model.",
    displayName: 'Kimi-K2.5',
    id: 'kimi-k2.5',
    maxOutput: 65_536,
    organization: 'Moonshot',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
];

export default volcengineCodingPlanChatModels;
