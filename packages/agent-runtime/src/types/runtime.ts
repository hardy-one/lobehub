import type { AgentEvent } from './event';
import type { AgentInstruction, AgentRuntimeContext } from './instruction';
import type { AgentState } from './state';

/**
 * What a `call_llm` execution actually did, so the runtime can update the
 * resume seed and call accounting from the real outcome rather than guessing
 * from the instruction type.
 */
export interface LLMExecutionInfo {
  /** Assistant message id this call created or reused, when it reached that stage. */
  assistantMessageId?: string;
  /** Provider attempts actually made (0 when nothing was sent). */
  attempts?: number;
  /** Whether it reused a resume-seeded placeholder instead of creating a row. */
  claimedSeed?: boolean;
  /** A recoverable failure the agent should handle on the next step. */
  recovery?: 'context_overflow';
  /** Whether a request was actually dispatched to the provider. */
  sent: boolean;
}

export interface InstructionExecutionResult {
  events: AgentEvent[];
  /** Present for `call_llm` executions; absent for other instructions. */
  llmExecution?: LLMExecutionInfo;
  newState: AgentState;
  /** Next context to pass to Agent runner (if execution should continue) */
  nextContext?: AgentRuntimeContext;
}

export type InstructionExecutor = (
  instruction: AgentInstruction,
  state: AgentState,
  /**
   * Runtime context for this step
   * Contains stepContext with dynamic state like lobe-agent todos
   */
  context?: AgentRuntimeContext,
) => Promise<InstructionExecutionResult>;

export interface RuntimeConfig {
  /** Custom executors for specific instruction types */
  executors?: Partial<Record<AgentInstruction['type'], InstructionExecutor>>;
  /** Function to get operation context and abort controller */
  getOperation?: (operationId: string) => {
    abortController: AbortController;
    context: Record<string, any>;
  };
  /** Operation ID for tracking this runtime instance */
  operationId?: string;
}
