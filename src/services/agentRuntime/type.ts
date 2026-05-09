import { type OpenAIChatMessage } from '@/types/openai/chat';

export interface StreamEvent {
  data?: any;
  /** Stream event ID from Redis or InMemory manager (format: "timestamp-sequence") */
  id?: string;
  operationId?: string;
  stepIndex?: number;
  timestamp: number;
  type:
    | 'connected'
    | 'agent_runtime_init'
    | 'agent_runtime_end'
    | 'stream_start'
    | 'stream_chunk'
    | 'stream_end'
    | 'stream_retry'
    | 'tool_start'
    | 'tool_end'
    | 'step_start'
    | 'step_complete'
    | 'error'
    | 'heartbeat';
}

export interface StreamConnectionOptions {
  historyLimit?: number;
  includeHistory?: boolean;
  lastEventId?: string;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
  onEvent?: (event: StreamEvent) => void;
}

export interface AgentOperationRequest {
  agentConfig?: {
    [key: string]: any;
    costLimit?: {
      currency: string;
      maxTotalCost: number;
      onExceeded: 'stop' | 'interrupt' | 'continue';
    };
    enableRAG?: boolean;
    enableSearch?: boolean;
    humanApprovalRequired?: boolean;
    maxSteps?: number;
  };
  appSessionId?: string;
  autoStart?: boolean;
  messages: OpenAIChatMessage[];
  modelRuntimeConfig: {
    [key: string]: any;
    model: string;
    provider: string;
  };
  userMessageId: string;
}

export interface AgentOperationResponse {
  autoStart: boolean;
  createdAt: string;
  firstStep?: {
    context?: any;
    messageId?: string;
    scheduled: boolean;
  };
  operationId: string;
  status: string;
  success: boolean;
}

export interface HumanInterventionRequest {
  action: 'approve' | 'reject' | 'input' | 'select';
  data?: any;
  operationId: string;
  reason?: string;
}
