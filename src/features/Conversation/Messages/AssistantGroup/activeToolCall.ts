import type { ChatToolPayloadWithResult } from '@lobechat/types';

import { hasToolResultBody } from './Tool/toolResultBody';

/**
 * Whether a tool call has already settled, i.e. must stop reading as loading.
 *
 * A settled call keeps its result (or its intervention) for good, so a finished
 * row never flips back into "loading" because a sibling is still running.
 */
const isSettled = (tool: ChatToolPayloadWithResult): boolean =>
  !!tool.intervention || !!tool.result?.error || hasToolResultBody(tool.result);

/**
 * Resolve which rows of one tool block are still executing.
 *
 * The operation flags behind "is this message executing" are per message: one
 * running `toolCalling` operation covers every tool call in the block, so a row
 * cannot decide on its own. Resolving the whole block once also keeps the N rows
 * on one subscription instead of one per row.
 *
 * A batch is not necessarily serial. Only calls marked `ordered` and calls that
 * name the same serialized resource run in emission order; every other call gets
 * its own lane and starts immediately, so picking "the last unfinished row" would
 * leave a concurrently running row static. Per-call evidence therefore wins where
 * it exists:
 *
 * - a running operation carrying this call's `tool_call_id` means it is running;
 * - a settled result means it is not;
 * - with no per-call evidence at all, the last call without a settled result is
 *   the one the block is working on — earlier ones were passed over or never got
 *   a merged result — and stays marked as the fallback while operations resolve.
 *
 * @param tools the calls in this block
 * @param isMessageExecuting whether the message still has a running operation
 * @param runningToolCallIds ids that a running operation reported as executing;
 *   `undefined` while they are not resolved yet, which falls back to the rule
 *   above instead of clearing every spinner for one frame
 */
export const resolveExecutingToolCallIds = (
  tools: ChatToolPayloadWithResult[] | undefined,
  isMessageExecuting: boolean,
  runningToolCallIds: ReadonlySet<string> | undefined,
): string[] => {
  if (!isMessageExecuting || !tools || tools.length === 0) return [];

  const reportedRunning = (tool: ChatToolPayloadWithResult): boolean =>
    runningToolCallIds?.has(tool.id) === true;

  // Any call the operations report as running is proof that the block tracks
  // calls individually, so the unfinished-tail guess is no longer needed — and
  // applying it anyway would light up a call that already finished but never
  // got a merged result.
  const hasReportedRunning = runningToolCallIds
    ? tools.some((tool) => !isSettled(tool) && reportedRunning(tool))
    : false;

  let trailingInFlightId: string | undefined;
  if (!hasReportedRunning) {
    for (let index = tools.length - 1; index >= 0; index -= 1) {
      const tool = tools[index];
      if (!isSettled(tool)) {
        trailingInFlightId = tool.id;
        break;
      }
    }
  }

  return tools
    .filter((tool) => !isSettled(tool) && (reportedRunning(tool) || tool.id === trailingInFlightId))
    .map((tool) => tool.id);
};
