import { type AIChatModelCard } from '../types/aiModel';

// ref: https://platform.stepfun.com/docs/zh/step-plan/overview
// Models synced from https://models.dev/api.json → stepfun-step-plan

const stepfunCodingPlanChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
      video: true,
    },
    contextWindowTokens: 256_000,
    description: 'Newer StepFun flash model for faster agents, coding, and multimodal prompts',
    displayName: 'Step 3.7 Flash',
    enabled: true,
    family: 'step',
    generation: 'step-3.7',
    id: 'step-3.7-flash',
    maxOutput: 256_000,
    organization: 'StepFun',
    releasedAt: '2026-05-29',
    settings: {
      // reasoning_options: [{"type": "effort", "values": ["low", "medium", "high"]}]
      extendParams: ['reasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 256_000,
    description: 'StepFun flash lane for quick multimodal reasoning and coding assistance',
    displayName: 'Step 3.5 Flash',
    enabled: false,
    family: 'step',
    generation: 'step-3.5',
    id: 'step-3.5-flash',
    maxOutput: 256_000,
    organization: 'StepFun',
    releasedAt: '2026-01-29',
    settings: {
      // reasoning_options: [{"type": "effort", "values": ["low", "high"]}]
      extendParams: ['step3_5ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 256_000,
    description: 'StepFun flash model for efficient multimodal reasoning, coding, and tool use',
    displayName: 'Step 3.5 Flash 2603',
    enabled: false,
    family: 'step',
    generation: 'step-3.5',
    id: 'step-3.5-flash-2603',
    maxOutput: 256_000,
    organization: 'StepFun',
    releasedAt: '2026-04-02',
    settings: {
      // reasoning_options: [{"type": "effort", "values": ["low", "high"]}]
      extendParams: ['step3_5ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true },
    contextWindowTokens: 256_000,
    description: 'StepFun routing model that dispatches requests to the appropriate Step model.',
    displayName: 'Step Router v1',
    enabled: false,
    family: 'step',
    id: 'step-router-v1',
    maxOutput: 256_000,
    organization: 'StepFun',
    releasedAt: '2026-05-29',
    type: 'chat',
  },
];

export default stepfunCodingPlanChatModels;
