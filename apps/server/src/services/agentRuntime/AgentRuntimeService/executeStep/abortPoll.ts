import debug from 'debug';

import type { AgentRuntimeServiceContext } from '../types';
import { sharedAbortMonitor } from './abortMonitor';

const log = debug('lobe-server:agent-runtime-service');

/** What this module reads off the service. */
export type StepAbortPollDeps = Pick<AgentRuntimeServiceContext, 'coordinator'>;

/** The monitor only needs batched sentinel reads and status checks. */
export type StepAbortMonitorCoordinator = Pick<
  AgentRuntimeServiceContext['coordinator'],
  'getInterruptSentinels' | 'loadAgentStatus'
>;

export interface StepAbortPoll {
  signal: AbortSignal;
  /** Stop polling. Called from the step's `finally` on every exit path. */
  stop: () => void;
}

export function startStepAbortPoll(
  deps: StepAbortPollDeps,
  operationId: string,
  stepIndex: number,
): StepAbortPoll {
  // Interrupts arrive as a sentinel key beside the persisted state — the
  // request that asked for the stop runs in a different invocation, so
  // there is no in-process controller to share. All live steps register here
  // with the process-wide monitor instead of starting their own timer.
  const stepAbortController = new AbortController();
  sharedAbortMonitor.register(deps.coordinator, operationId, stepAbortController);
  log('[%s][%d] Registered with shared abort monitor', operationId, stepIndex);

  return {
    signal: stepAbortController.signal,
    stop: () => {
      sharedAbortMonitor.unregister(operationId, stepAbortController);
    },
  };
}
