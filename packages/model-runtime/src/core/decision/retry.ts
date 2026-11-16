/**
 * Error identifiers that mean the caller — not the route — caused the failure. Retrying them
 * would resurrect a cancelled call, hide a bad key, or turn a rejected request into an empty
 * success.
 *
 * Written as literals rather than `AgentRuntimeErrorType` members: the runtime branches on the
 * string a provider or adapter produces, and `AbortError` in particular has no member there.
 */
const NON_RETRYABLE_IDENTIFIERS = new Set<string>([
  'AbortError',
  'ContentModeration',
  'ExceededContextWindow',
  'ExceededImageLimit',
  'InsufficientQuota',
  'InvalidProviderAPIKey',
  'InvalidRequestFormat',
  'PermissionDenied',
  'QuotaLimitReached',
  'RateLimitExceeded',
  'RequestBodyTooLarge',
  'UserConfigError',
]);

/** A caller-side deadline: retrying doubles the time the caller already gave up on. */
const TIMEOUT_IDENTIFIERS = new Set<string>([
  'TimeoutError',
  'APIConnectionTimeoutError',
  'RequestTimeoutError',
]);

/** How deep to walk the wrappers a runtime puts around an upstream error. */
const MAX_WRAPPER_DEPTH = 3;

const wrappersOf = (value: object): unknown[] => {
  const record = value as Record<string, unknown>;

  return [record.error, record.cause, record.errorResult];
};

/**
 * Whether any layer of a wrapped error carries `identifier`. A runtime maps an upstream failure
 * through its own error type, so the marker the caller needs is often not on the outermost object.
 */
const containsIdentifier = (
  value: unknown,
  identifiers: ReadonlySet<string>,
  depth = 0,
): boolean => {
  if (!value || typeof value !== 'object' || depth > MAX_WRAPPER_DEPTH) return false;

  const record = value as Record<string, unknown>;
  for (const key of ['errorType', 'name', 'code'] as const) {
    const candidate = record[key];
    if (typeof candidate === 'string' && identifiers.has(candidate)) return true;
  }

  return wrappersOf(record).some((wrapped) => containsIdentifier(wrapped, identifiers, depth + 1));
};

/** The identifier closest to the surface, which is the one the runtime normalized the error to. */
const outerIdentifier = (value: unknown, depth = 0): string | undefined => {
  if (!value || typeof value !== 'object' || depth > MAX_WRAPPER_DEPTH) return undefined;

  const record = value as Record<string, unknown>;
  for (const key of ['errorType', 'name', 'code'] as const) {
    const candidate = record[key];
    if (typeof candidate === 'string') return candidate;
  }

  for (const wrapped of wrappersOf(record)) {
    const found = outerIdentifier(wrapped, depth + 1);
    if (found) return found;
  }

  return undefined;
};

/**
 * Whether the caller cancelled, however far the runtime wrapped the reason. An already-aborted
 * signal counts even when the adapter lost the marker on the way out.
 */
export const isCancelled = (error: unknown, signal?: AbortSignal): boolean => {
  if (signal?.aborted) return true;

  return containsIdentifier(error, new Set(['AbortError']));
};

/**
 * Whether a failed native decision call may be retried through structured output.
 *
 * Only failures that could mean the route is unavailable qualify: cancellation, deadlines and the
 * caller's own conditions surface unchanged, so a retry never masks what actually happened.
 */
export const shouldRetryDecisionAsEmulated = (error: unknown, signal?: AbortSignal): boolean => {
  if (isCancelled(error, signal)) return false;
  if (containsIdentifier(error, TIMEOUT_IDENTIFIERS)) return false;

  const identifier = outerIdentifier(error);

  return !identifier || !NON_RETRYABLE_IDENTIFIERS.has(identifier);
};
