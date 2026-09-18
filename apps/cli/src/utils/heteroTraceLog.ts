/**
 * Cross-end timing trace for heterogeneous-agent runs.
 *
 * One line per phase, emitted to **stderr** (stdout carries JSONL events in
 * `--render jsonl` mode, so it must stay clean), with an absolute ISO
 * timestamp, a ms offset from this side's run start, and the operation id —
 * so a multi-end incident (device CLI ⇄ server ⇄ web) can be lined up without
 * trusting a single machine's clock.
 *
 * Format (stable, greppable, one line):
 *
 *   [HETERO-TRACE] side=cli-exec op=op_… at=2026-…Z elapsed=1234ms phase=… detail={…}
 *
 * TEMPORARY DIAGNOSTICS: printed unconditionally and meant to be removed once
 * the "run keeps spinning after the answer" investigation is closed.
 */

export interface HeteroTraceDetail {
  [key: string]: unknown;
}

export interface HeteroTraceScope {
  /** A phase logger bound to a different operation id (e.g. a retried run). */
  forOperation: (operationId: string) => HeteroTraceScope;
  readonly operationId: string;
  /** Emit one phase line. */
  phase: (name: string, detail?: HeteroTraceDetail) => void;
  readonly side: string;
  /** Absolute time this scope was created. */
  readonly startedAt: Date;
}

const iso = (date: Date): string => date.toISOString();

const stringifyDetail = (detail: HeteroTraceDetail): string => {
  try {
    return JSON.stringify(detail, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
  } catch {
    return '"<unserializable>"';
  }
};

/**
 * A scope is per (side, operation): every line carries the same `op=…` so
 * grep-ing one operation id shows the whole timeline in order.
 */
export const createHeteroTraceScope = (params: {
  /** Fixed start for `elapsed` — pass the moment the side received the run. */
  anchorAt?: Date;
  extra?: HeteroTraceDetail;
  operationId: string;
  side: string;
}): HeteroTraceScope => {
  const anchor = params.anchorAt ?? new Date();

  // The run descriptor is identical on every line of a scope, so it is
  // emitted once (first phase) to keep a tool-heavy run's log readable.
  let runDescriptorEmitted = false;

  const emit = (scopeOperationId: string, name: string, detail?: HeteroTraceDetail) => {
    const now = new Date();
    const fields = [
      '[HETERO-TRACE]',
      `side=${params.side}`,
      `op=${scopeOperationId}`,
      `at=${iso(now)}`,
      `anchor=${iso(anchor)}`,
      `elapsed=${now.getTime() - anchor.getTime()}ms`,
      `phase=${name}`,
    ];
    if (params.extra && !runDescriptorEmitted) {
      runDescriptorEmitted = true;
      fields.push(`run=${stringifyDetail(params.extra)}`);
    }
    if (detail && Object.keys(detail).length > 0) fields.push(`detail=${stringifyDetail(detail)}`);
    try {
      process.stderr.write(`${fields.join(' ')}\n`);
    } catch {
      /* diagnostics must never break a run */
    }
  };

  return {
    forOperation: (operationId) =>
      createHeteroTraceScope({ ...params, anchorAt: anchor, operationId }),
    operationId: params.operationId,
    phase: (name, detail) => emit(params.operationId, name, detail),
    side: params.side,
    startedAt: anchor,
  };
};

/** True when the event is the stream's terminal marker for a run. */
export const isTerminalStreamEvent = (type: string): boolean =>
  type === 'agent_runtime_end' || type === 'error';

/**
 * True when the event carries agent output (text / reasoning / tool work).
 *
 * Deliberately excludes the adapter's bookkeeping events (`stream_end`,
 * `visible_output_end`) — the settlement batch contains those *immediately*
 * before `agent_runtime_end`, so measuring the gap from "any non-terminal
 * event" always yields 0 and hides the real wait.
 */
export const isOutputStreamEvent = (type: string): boolean =>
  type === 'stream_chunk' || type === 'tool_start' || type === 'tool_result' || type === 'tool_end';
