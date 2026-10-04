import type { HeterogeneousAgentRuntimeStatus } from '../types';

export interface HeterogeneousAgentBroadcastEvents {
  heteroAgentPiQueueUpdate: (params: {
    followUp: string[];
    sessionId: string;
    steering: string[];
  }) => void;
  heteroAgentRuntimeStatus: (params: HeterogeneousAgentRuntimeStatus) => void;
}
