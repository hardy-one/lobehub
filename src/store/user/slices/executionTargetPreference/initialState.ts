import type { ExecutionTargetSelection } from '@lobechat/types';

export interface ExecutionTargetPreferenceState {
  executionTargetPreferenceMap: Record<string, ExecutionTargetSelection | null>;
}

export const initialExecutionTargetPreferenceState: ExecutionTargetPreferenceState = {
  executionTargetPreferenceMap: {},
};

export const agentExecutionTargetPreferenceKey = (agentId: string) => `agent:${agentId}`;
export const topicExecutionTargetPreferenceKey = (topicId: string) => `topic:${topicId}`;
