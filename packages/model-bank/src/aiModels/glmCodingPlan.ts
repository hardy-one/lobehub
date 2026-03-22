import { type AIChatModelCard } from '../types/aiModel';

// ref: https://docs.z.ai/devpack/overview

const glmCodingPlanChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 202_752,
    description:
      'GLM-5: Advanced model rivaling Claude Opus, designed for complex systems engineering and long-horizon agentic tasks.',
    displayName: 'GLM-5',
    id: 'GLM-5',
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
    contextWindowTokens: 202_752,
    description: 'GLM-5-Turbo: Optimized version of GLM-5 with faster inference for coding tasks.',
    displayName: 'GLM-5-Turbo',
    id: 'GLM-5-Turbo',
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
    contextWindowTokens: 202_752,
    description: 'GLM-4.7: Flagship model with strong coding capabilities.',
    displayName: 'GLM-4.7',
    id: 'GLM-4.7',
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
    },
    contextWindowTokens: 202_752,
    description: 'GLM-4.6: Previous generation model.',
    displayName: 'GLM-4.6',
    id: 'GLM-4.6',
    maxOutput: 65_536,
    organization: 'Zhipu',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 202_752,
    description: 'GLM-4.5: High-performance model for reasoning, coding, and agent tasks.',
    displayName: 'GLM-4.5',
    id: 'GLM-4.5',
    maxOutput: 65_536,
    organization: 'Zhipu',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 202_752,
    description: 'GLM-4.5-Air: Lightweight version for fast responses.',
    displayName: 'GLM-4.5-Air',
    id: 'GLM-4.5-Air',
    maxOutput: 65_536,
    organization: 'Zhipu',
    type: 'chat',
  },
];

export default glmCodingPlanChatModels;
