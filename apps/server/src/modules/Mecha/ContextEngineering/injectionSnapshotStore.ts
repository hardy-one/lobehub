import { InjectionSnapshotStore } from '@lobechat/context-engine';

/**
 * A topic is one chat session. Its snapshots must outlive a single agent
 * operation so the second turn reuses the bytes the first turn solidified.
 * `RuntimeExecutorContext` is built per operation (and, on serverless hosts,
 * per invocation), so it cannot own the store. The minimum host-level attach
 * point is therefore this process-wide registry keyed by topic id.
 *
 * Trade-off: the registry is per process. A topic that lands on another
 * instance/miss re-derives its snapshots once; correctness is unaffected and
 * only prefix-cache stability across processes is lost. Moving this to Redis
 * is a separate durability change, not part of this wiring fix.
 */
const MAX_SESSIONS = 500;
const SESSION_IDLE_TTL_MS = 6 * 60 * 60 * 1000;

interface RegistryEntry {
  lastUsedAt: number;
  store: InjectionSnapshotStore;
}

const registry = new Map<string, RegistryEntry>();

const evictStale = (now: number): void => {
  for (const [topicId, entry] of registry) {
    if (now - entry.lastUsedAt > SESSION_IDLE_TTL_MS) registry.delete(topicId);
  }
  // Map preserves insertion order; the oldest entry is the least recently used
  // because every access re-inserts it below.
  while (registry.size > MAX_SESSIONS) {
    const oldest = registry.keys().next().value;
    if (oldest === undefined) break;
    registry.delete(oldest);
  }
};

/**
 * Return the snapshot store for a conversation, creating it on first use.
 * No topic id means no session key, so the caller must fall back to the
 * engine's legacy path.
 */
export const getServerInjectionSnapshotStore = (
  topicId: string | undefined,
): InjectionSnapshotStore | undefined => {
  if (!topicId) return undefined;

  const now = Date.now();
  evictStale(now);

  const existing = registry.get(topicId);
  if (existing) {
    existing.lastUsedAt = now;
    // Re-insert so the eviction order reflects recency.
    registry.delete(topicId);
    registry.set(topicId, existing);
    return existing.store;
  }

  const store = new InjectionSnapshotStore();
  registry.set(topicId, { lastUsedAt: now, store });
  return store;
};
