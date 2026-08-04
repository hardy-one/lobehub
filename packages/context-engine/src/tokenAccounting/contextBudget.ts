import type { ChatTopicMetadata } from '@lobechat/types';

/**
 * Stored real context tokens on `topic.metadata.contextTokens` — the measured
 * size of the most recent completed request on this topic (`usage.totalTokens`,
 * input + output; the output is already part of the history sent next turn).
 *
 * The compression budget reuses this real value and only estimates messages
 * added since (see `shouldCompress` in agent-runtime) — history carries zero
 * estimation error. This module keeps the storage-side concerns in one place:
 *
 *   - `readStoredContext` — validity check (positive token count + anchor id +
 *     agent-config signature)
 *   - `buildStoredContext` — construct the entry to persist after a request
 *   - `signAgentConfig` — cheap signature of the context-affecting agent
 *     config, so any config edit (systemRole / plugins / knowledge bases /
 *     chatConfig) invalidates a previously stored baseline.
 *
 * Why signature over event-driven invalidation: every config-affecting edit
 * (agent save, plugin toggle, KB toggle, skill mode) lands in `agentConfig`
 * one way or another, so a single read-side comparison covers them all with
 * zero per-entry maintenance. False positives (edits that don't actually
 * change the context, e.g. a model switch) only cost one full estimation and
 * self-correct on the next request — cheap in both directions. Pure functions,
 * no store/DB dependency: callers (client/server) own persistence via their
 * existing `updateTopicMetadata` path.
 *
 * Callers note: the runtime state message carries no usage (buildFinalState
 * pushes {content, id, ...}); the persisted message does — on the client as
 * `metadata.usage`, on the server as the promoted top-level `usage` column.
 * Persistence points must therefore find the last assistant message that
 * carries usage (previous turn), not the last assistant in the runtime state.
 *
 * Known trade-offs (deliberate):
 *   - The signature is only self-consistent within one runtime (client resolves
 *     the agent config, server uses the DB snapshot); switching runtimes
 *     between requests invalidates the baseline once — a conservative fallback
 *     that self-corrects on the next completed request.
 *   - `totalTokens` includes reasoning tokens on long-CoT models while the
 *     next request's history only carries the visible content, slightly
 *     over-counting the baseline (compresses a bit earlier — safe direction).
 */

/** Lightweight stable hash (djb2) — no external dependency. */
const hashString = (input: string): string => {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
};

export interface StoredContextEntry {
  /** Id of the last message covered by `tokens` — the anchor for the incremental estimate. */
  lastMsgId: string;
  /** Agent-config signature at measurement time — see `signAgentConfig`. */
  signature: string;
  tokens: number;
}

/**
 * Stable signature of the context-affecting agent configuration. Any change
 * here (systemRole, plugins, knowledge bases, chatConfig) changes the
 * composition of the request, so a previously stored baseline no longer
 * describes the current context. The whole config is hashed — no field list
 * to maintain, and a false positive only costs one full estimation.
 */
export const signAgentConfig = (agentConfig: unknown): string =>
  hashString(JSON.stringify(agentConfig ?? null));

/** Safe ceiling for a stored baseline — no production window is larger. */
export const MAX_STORED_CONTEXT_TOKENS = 3_000_000;

/**
 * Read the stored baseline. Returns `undefined` when there is nothing stored,
 * the value is not usable (missing anchor / non-positive tokens, or tokens
 * beyond the sanity ceiling — e.g. client-forged), or the agent config
 * changed since measurement (`signature` mismatch) — callers then fall back
 * to full estimation.
 */
export const readStoredContext = (
  topicMeta: Pick<ChatTopicMetadata, 'contextTokens'> | undefined,
  signature?: string,
): { tokens: number; lastMsgId: string } | undefined => {
  const stored = topicMeta?.contextTokens;
  if (!stored || !stored.tokens || !stored.lastMsgId) return undefined;
  if (stored.tokens > MAX_STORED_CONTEXT_TOKENS) return undefined;
  if (signature !== undefined && stored.signature !== signature) return undefined;
  return { lastMsgId: stored.lastMsgId, tokens: stored.tokens };
};

/**
 * Build the `contextTokens` entry to persist after a completed request.
 * Returns `undefined` when there is nothing meaningful to store (missing usage
 * or anchor message id) — callers should then leave the stored value untouched
 * rather than overwrite it with garbage.
 */
export const buildStoredContext = (
  usage: { totalTokens?: number } | undefined,
  lastMsgId: string | undefined,
  signature: string,
): StoredContextEntry | undefined => {
  if (!usage?.totalTokens || !lastMsgId) return undefined;

  return {
    lastMsgId,
    signature,
    tokens: usage.totalTokens,
  };
};
