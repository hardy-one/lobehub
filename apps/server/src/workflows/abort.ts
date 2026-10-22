import { WorkflowAbort } from '@upstash/workflow';

/**
 * Whether an error is an Upstash workflow control signal rather than a failure.
 *
 * NOTICE: `WorkflowAbort` aborts a run by throwing, so it reaches every workflow's catch block on
 * each guard match and each completed step callback. `WorkflowNonRetryableError` and
 * `WorkflowRetryAfterError` extend it but express deliberate outcomes with their own messages, so
 * they are not classified as routine aborts and keep their own logging.
 *
 * Use when:
 * - Deciding whether a caught error should be reported or merely recorded at debug level
 *
 * Expects:
 * - `error` is anything caught from a workflow body or step
 *
 * Returns:
 * - `true` for a plain `WorkflowAbort` only
 */
export const isWorkflowAbort = (error: unknown): error is WorkflowAbort =>
  error instanceof WorkflowAbort &&
  error.name !== 'WorkflowNonRetryableError' &&
  error.name !== 'WorkflowRetryAfterError';
