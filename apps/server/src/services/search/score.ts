/**
 * Normalize provider relevance scores to the 0–3 scale exposed by search.
 *
 * Exa and Tavily document their scores as values in the 0–1 range. Keep the
 * shared scale bounded when a provider omits a score or returns malformed data,
 * so one result cannot make the model-facing thresholds meaningless.
 */
export const normalizeSearchScore = (score: number | null | undefined): number => {
  if (typeof score !== 'number' || !Number.isFinite(score)) return 0;

  const boundedScore = Math.min(Math.max(score, 0), 1);

  return Number((boundedScore * 3).toFixed(2));
};
