import { type AIChatModelCard } from '../types/aiModel';

// ref: https://platform.moonshot.ai/docs

const kimiCodingPlanChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      "Kimi K2.5: Kimi's most intelligent model, supporting visual and text input, thinking and non-thinking modes.",
    displayName: 'Kimi K2.5',
    id: 'kimi-k2.5',
    maxOutput: 65_536,
    organization: 'Moonshot',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Kimi K2: MoE architecture base model with exceptional code and Agent capabilities.',
    displayName: 'Kimi K2',
    id: 'kimi-k2',
    maxOutput: 65_536,
    organization: 'Moonshot',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Kimi K2 Thinking: Thinking model with general Agentic capabilities and reasoning abilities.',
    displayName: 'Kimi K2 Thinking',
    id: 'kimi-k2-thinking',
    maxOutput: 65_536,
    organization: 'Moonshot',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
];

export default kimiCodingPlanChatModels;
