/**
 * Cross-end timing trace for heterogeneous-agent runs (server side).
 *
 * Same one-line format as the CLI's `apps/cli/src/utils/heteroTraceLog.ts`:
 *
 *   [HETERO-TRACE] side=server op=op_… at=2026-…Z elapsed=1234ms phase=… detail={…}
 *
 * Printed unconditionally (`console.info`) instead of going through a
 * `debug()` namespace: an incident report is useless if the only log that
 * explains it was compiled out of the deployed build.
 *
 * TEMPORARY DIAGNOSTICS: meant to be removed once the investigation is closed.
 */

export interface HeteroTraceAnchor {
  readonly at: Date;
  readonly operationId: string;
}

const stringifyDetail = (detail: Record<string, unknown>): string => {
  try {
    return JSON.stringify(detail, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
  } catch {
    return '"<unserializable>"';
  }
};

/**
 * Emit one phase line. `detail` must stay small and non-secret (ids, counts,
 * durations) — this is a diagnostic channel, not a data channel.
 */
export const heteroTrace = (
  side: string,
  operationId: string,
  phase: string,
  detail?: Record<string, unknown>,
  anchor?: Date,
): void => {
  try {
    const now = new Date();
    const fields = [
      '[HETERO-TRACE]',
      `side=${side}`,
      `op=${operationId}`,
      `at=${now.toISOString()}`,
    ];
    if (anchor) fields.push(`anchor=${anchor.toISOString()}`);
    if (anchor) fields.push(`elapsed=${now.getTime() - anchor.getTime()}ms`);
    fields.push(`phase=${phase}`);
    if (detail && Object.keys(detail).length > 0) fields.push(`detail=${stringifyDetail(detail)}`);
    console.info(fields.join(' '));
  } catch {
    /* diagnostics must never break a request */
  }
};

/**
 * Server-side anchor per operation: the moment the server first touched this
 * run (dispatch or ingest), so every later phase reports `elapsed=` against a
 * single start without depending on another machine's clock.
 */
const anchors = new Map<string, Date>();

export const anchorHeteroRun = (operationId: string, at?: Date): Date => {
  const existing = anchors.get(operationId);
  if (existing) return existing;
  const anchor = at ?? new Date();
  anchors.set(operationId, anchor);
  // Bounded: a long-lived instance must not accumulate one entry per run.
  if (anchors.size > 500) {
    const oldest = anchors.keys().next().value;
    if (oldest) anchors.delete(oldest);
  }
  return anchor;
};
