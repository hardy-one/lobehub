/**
 * Cross-end timing trace for heterogeneous-agent runs (web/browser side).
 *
 * Same one-line format as the CLI (`apps/cli/src/utils/heteroTraceLog.ts`) and
 * the server (`apps/server/src/utils/heteroTrace.ts`), so one operation id
 * lines up device → server → browser in a single grep:
 *
 *   [HETERO-TRACE] side=web op=op_… at=2026-…Z elapsed=1234ms phase=… detail={…}
 *
 * Written to the browser console unconditionally — a run that "kept spinning"
 * has to be attributable to this leg without a rebuild. `elapsed` counts from
 * the first line this tab emitted for the operation, so it never depends on
 * another machine's clock.
 */

const anchors = new Map<string, number>();

export const heteroTraceWeb = (
  operationId: string,
  phase: string,
  detail?: Record<string, unknown>,
): void => {
  try {
    const now = Date.now();
    const anchor = anchors.get(operationId) ?? now;
    if (!anchors.has(operationId)) {
      anchors.set(operationId, anchor);
      // Bounded: a long-lived tab must not accumulate one entry per run.
      if (anchors.size > 50) {
        const oldest = anchors.keys().next().value;
        if (oldest) anchors.delete(oldest);
      }
    }
    const fields = [
      '[HETERO-TRACE]',
      'side=web',
      `op=${operationId}`,
      `at=${new Date(now).toISOString()}`,
      `anchor=${new Date(anchor).toISOString()}`,
      `elapsed=${now - anchor}ms`,
      `phase=${phase}`,
    ];
    if (detail && Object.keys(detail).length > 0) {
      fields.push(`detail=${JSON.stringify(detail)}`);
    }
    console.info(fields.join(' '));
  } catch {
    /* diagnostics must never break the UI */
  }
};
