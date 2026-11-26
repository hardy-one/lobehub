import {
  type AgentEvent,
  type AgentRuntimeContext,
  type AgentState,
  getLlmCallCount,
  normalizeAgentState,
} from '@lobechat/agent-runtime';
import debug from 'debug';
import { type Redis } from 'ioredis';

import { getServerFeatureFlagsStateFromRuntimeConfig } from '@/server/featureFlags';

import { hasNonPersistedMessage } from './messagePersistence';
import { getAgentRuntimeRedisClient } from './redis';
import { restoreSlimState, slimStateForPersist } from './slimAgentState';

const log = debug('lobe-server:agent-runtime:agent-state-manager');

const REFRESH_OWNED_LOCK_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('expire', KEYS[1], ARGV[2]) else return 0 end";
/**
 * Drop the inline envelope only while this worker still owns the operation lock.
 *
 * An unconditional DEL is unsafe: a redelivery can read envelope k, stall while
 * the active worker finishes k and parks k+1, then lose the lock race and be
 * told its step is stale. Clearing there would delete a live worker's newer
 * recovery pointer. Ownership of the lock is exactly the right predicate —
 * whoever holds it is the worker whose envelope this is.
 *
 * KEYS[1] = operation lock, KEYS[2] = inline resume envelope, ARGV[1] = owner.
 */
const CLEAR_OWNED_INLINE_RESUME_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[2]) else return 0 end";
const RELEASE_OWNED_LOCK_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
/**
 * Claim the lock, or re-enter it when this exact owner already holds it.
 *
 * Re-entry exists for the inline step loop, which runs several steps under one
 * lock. Owner ids carry a random UUID (see `createStepLockOwner`), so only the
 * invocation that took the lock can present its owner id — a redelivery from
 * the queue always mints a different one and still loses the race.
 */
const CLAIM_OR_REENTER_LOCK_SCRIPT = `
if redis.call('set', KEYS[1], ARGV[1], 'EX', ARGV[2], 'NX') then return 1 end
if redis.call('get', KEYS[1]) == ARGV[1] then
  redis.call('expire', KEYS[1], ARGV[2])
  return 1
end
return 0`;

type ParsedToolSet = Record<string, any>;

/**
 * Execution-local parsed tool set. There is deliberately no process-global
 * cache and no TTL/version protocol: Redis stays the authoritative store, and
 * a new lock owner or process always cold-reads it. The object is kept only
 * for the lifetime of one owner's inline continuation, then frozen so steps
 * share one parsed value rather than copying it or parsing it again.
 */
interface ToolSetExecutionCache {
  ownerId: string;
  toolSet?: ParsedToolSet;
}

const freezeToolSet = (value: unknown): ParsedToolSet => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Externalized agent tool set must be a JSON object');
  }
  const visit = (item: unknown): unknown => {
    if (!item || typeof item !== 'object' || Object.isFrozen(item)) return item;
    if (Array.isArray(item)) {
      for (const child of item) visit(child);
    } else {
      for (const child of Object.values(item)) visit(child);
    }
    return Object.freeze(item);
  };
  return visit(value) as ParsedToolSet;
};

/**
 * Whether a persisted blob may leave out the copies `slimStateForPersist`
 * drops (see `slimAgentState.ts`): runtime flag `agent_runtime_slim_state`,
 * overridden by `AGENT_RUNTIME_SLIM_STATE` (`0` kill switch, `1` force on).
 * The load path restores them unconditionally, so flipping it either way is
 * safe for operations in flight.
 *
 * The flag is resolved per operation owner and cached here for a few seconds
 * on top of the runtime-config provider's own snapshot cache, so a publish
 * still lands within seconds without a redeploy and a save pays no per-owner
 * lookup. If resolution fails, the blob is not slimmed rather than failing the
 * save.
 */
const SLIM_FLAG_CACHE_TTL_MS = 5000;
const SLIM_FLAG_CACHE_MAX = 1024;

const envOverride = (name: string): boolean | undefined => {
  const value = process.env[name];
  if (value === '0') return false;
  if (value === '1') return true;
  return undefined;
};

/**
 * Resolved values, keyed by owner ('' for the global value).
 *
 * `getMergedFeatureFlags` always reads the per-user override record when it is
 * given a user id, and that provider does not cache a missing record
 * (`cacheNullSnapshots: false`). Resolving with the owner on every save would
 * therefore put a Redis GET on the per-step write path for every operation
 * whose owner has no override. This cache bounds the lookup to once per owner
 * per TTL.
 */
const slimFlagCache = new Map<string, { expiresAt: number; value: boolean }>();

/** Clear the slim-state flag resolution cache (for testing). */
export const resetSlimAgentStateCache = () => {
  slimFlagCache.clear();
};

const resolveSlimFlag = async (userId?: string): Promise<boolean> => {
  // Owners without a user id all resolve the global value, so they share a key.
  const cacheKey = userId ?? '';
  const cached = slimFlagCache.get(cacheKey);
  if (cached) {
    if (cached.expiresAt > Date.now()) return cached.value;
    slimFlagCache.delete(cacheKey);
  }

  try {
    const flags = await getServerFeatureFlagsStateFromRuntimeConfig(userId);
    const value = flags.enableSlimAgentState === true;

    // Evict the oldest entry instead of growing with the number of owners.
    if (slimFlagCache.size >= SLIM_FLAG_CACHE_MAX) {
      const oldestKey = slimFlagCache.keys().next().value;
      if (oldestKey !== undefined) slimFlagCache.delete(oldestKey);
    }
    slimFlagCache.set(cacheKey, { expiresAt: Date.now() + SLIM_FLAG_CACHE_TTL_MS, value });

    return value;
  } catch (error) {
    // Deliberately not cached: a transient read failure must not pin the flag
    // off for a whole TTL.
    log('Failed to resolve agent state slim flag, keeping copies inline: %O', error);
    return false;
  }
};

const resolveSlim = async (userId?: string): Promise<boolean> =>
  envOverride('AGENT_RUNTIME_SLIM_STATE') ?? (await resolveSlimFlag(userId));

export interface StepResult {
  events?: AgentEvent[];
  executionTime: number;
  newState: AgentState;
  nextContext?: AgentRuntimeContext;
  stepIndex: number;
}

export interface AgentOperationMetadata {
  /**
   * The client that started this operation handles `member_runtime_end`. Only
   * then does the Gateway stream notifier rename a mirrored group member's
   * terminal on this operation's channel; a client released before the rename
   * still gets the verbatim `agent_runtime_end` it retires member columns on.
   */
  acceptsMemberRuntimeEnd?: boolean;
  agentConfig?: any;
  createdAt: string;
  lastActiveAt: string;
  /**
   * When set, the Gateway stream notifier mirrors this operation's stream events
   * onto the named operation's Gateway channel as well (single-connection
   * multiplexing). Used so a broadcast member's streaming events also flow down
   * the supervisor's existing WebSocket — the supervisor's own operationId —
   * instead of stranding on a member channel nobody subscribes to.
   */
  mirrorToOperationId?: string;
  modelRuntimeConfig?: any;
  status: AgentState['status'];
  /**
   * Gateway WS channel owner when it differs from the executing user. For
   * shared-agent visitor runs the operation EXECUTES as the creator
   * (`userId`), but only the visitor may subscribe to its stream — the
   * gateway registers the channel under this id and rejects other subs.
   */
  streamOwnerUserId?: string;
  totalCost: number;
  totalSteps: number;
  userId?: string;
  /**
   * Workspace the operation runs in (null/undefined = personal). Persisted so
   * queue workers (e.g. QStash `runStep`) can reconstruct a workspace-scoped
   * runtime; without it the runtime is personal-scoped and message/topic
   * lookups miss workspace-scoped rows.
   */
  workspaceId?: string;
}

export class AgentStateManager {
  private readonly toolSetExecutionCaches = new Map<string, ToolSetExecutionCache>();

  /**
   * Bind a parsed tool set to one lock owner's inline execution. Re-entering
   * with the same owner keeps the parsed object; any other owner replaces it.
   */
  withToolSetCache(operationId: string, ownerId: string): () => void {
    const cache = this.toolSetExecutionCaches.get(operationId);
    if (cache && cache.ownerId === ownerId) return () => {};
    this.toolSetExecutionCaches.set(operationId, { ownerId });
    return () => {
      const current = this.toolSetExecutionCaches.get(operationId);
      if (current?.ownerId === ownerId) this.toolSetExecutionCaches.delete(operationId);
    };
  }

  /** Discard a stale execution snapshot after a lock loss or redelivery. */
  invalidateToolSetCache(operationId: string, ownerId?: string): void {
    const cache = this.toolSetExecutionCaches.get(operationId);
    if (!cache || (ownerId && cache.ownerId !== ownerId)) return;
    this.toolSetExecutionCaches.delete(operationId);
  }

  private redis: Redis;
  private readonly STATE_PREFIX = 'agent_runtime_state';
  private readonly TOOLSET_PREFIX = 'agent_runtime_toolset';
  private readonly STEPS_PREFIX = 'agent_runtime_steps';
  private readonly METADATA_PREFIX = 'agent_runtime_meta';
  private readonly INTERRUPT_PREFIX = 'agent_runtime_interrupt';
  private readonly QUEUED_MESSAGES_PREFIX = 'agent_runtime_queued_messages';
  private readonly INLINE_RESUME_PREFIX = 'agent_runtime_inline_resume';
  private readonly DEFAULT_TTL = 2 * 3600; // 2h

  constructor() {
    const redisClient = getAgentRuntimeRedisClient();
    if (!redisClient) {
      throw new Error('Redis is not available. Please configure REDIS_URL environment variable.');
    }
    this.redis = redisClient;
  }

  /**
   * Serialize an AgentState for Redis persistence, dropping the `messages`
   * array first.
   *
   * `messages` is the dominant size driver of the serialized state — long
   * topics inline tool results and base64 media, pushing the blob past
   * Upstash's 10MB single-request limit, which throws and drops the op
   * outright (StateStorePersistError). It is also fully reconstructible: the
   * canonical rows live in the DB and every step rehydrates `state.messages`
   * from there on entry (`AgentRuntimeService.rehydrateStateMessagesFromDB`),
   * while the few out-of-band readers fall back to a DB query. So we never
   * serialize it into the persisted blob.
   *
   * Keep this in sync with the stream-event strip in `StreamEventManager`
   * (`stripStateForStream`) and the `done`-event strip in
   * `OperationTraceRecorder` — all drop the same reconstructible payload.
   *
   * Exception: when the working set carries a non-persisted (ephemeral /
   * suppressed) message — one with no DB row — the array is NOT reconstructible
   * from a query, so persist it in full. These ops are rare and short-lived
   * (group-member supervisor turns); the size win is forgone to avoid losing
   * the prompt.
   */
  private serializeStateForPersist(state: AgentState, slim: boolean): string {
    // Copies of the tool set are dropped against the full state, before the tool
    // set itself leaves the blob; `restoreSlimState` rebuilds them after it is
    // re-attached on load.
    const source = slim ? slimStateForPersist(state) : state;
    // `operationToolSet` is externalized to its own key (see
    // `externalizeToolSet`) and re-attached on load, so it never travels in the
    // blob. It is immutable after creation, so a single write per operation
    // replaces re-serializing ~300–400 KB of tool schemas at every step.
    const { operationToolSet: _toolSet, ...withoutToolSet } = source as AgentState & {
      operationToolSet?: unknown;
    };
    const persistable = withoutToolSet as AgentState & { messages?: unknown };
    if (
      !state.origin?.agentId ||
      !state.origin.topicId ||
      hasNonPersistedMessage(persistable.messages)
    ) {
      return JSON.stringify(persistable);
    }
    const { messages: _messages, ...rest } = persistable;
    return JSON.stringify(rest);
  }

  private toolSetKey(operationId: string): string {
    return `${this.TOOLSET_PREFIX}:${operationId}`;
  }

  /**
   * Persist the operation's tool set to its authoritative Redis key once per
   * execution. Later saves only refresh that key's TTL in lockstep with the
   * state blob; a new lock owner writes once again.
   *
   * The tool set is immutable for an operation. If a caller changes it after a
   * later save, write the new value and replace the execution snapshot.
   */
  private async externalizeToolSet(operationId: string, state: AgentState): Promise<void> {
    const toolSet = (state as { operationToolSet?: unknown }).operationToolSet;
    if (!toolSet) return;
    const cache = this.toolSetExecutionCaches.get(operationId);
    if (cache?.toolSet && JSON.stringify(cache.toolSet) === JSON.stringify(toolSet)) return;
    await this.redis.setex(this.toolSetKey(operationId), this.DEFAULT_TTL, JSON.stringify(toolSet));
    if (cache) cache.toolSet = freezeToolSet(toolSet);
  }

  /**
   * Re-attach the externalized tool set to a freshly loaded state. Served from
   * the execution cache after the first read, so one owner's inline loop parses
   * it once and sees the same value at every step. A handoff or process switch
   * starts with no cache and cold-reads Redis. A blob that still carries its
   * tool set inline — written by pre-externalization code during a rolling
   * deploy — is left untouched.
   */
  private async rehydrateToolSet(operationId: string, state: AgentState): Promise<void> {
    if ((state as { operationToolSet?: unknown }).operationToolSet) return;
    const cache = this.toolSetExecutionCaches.get(operationId);
    if (cache?.toolSet) {
      (state as { operationToolSet?: unknown }).operationToolSet = cache.toolSet;
      return;
    }
    const json = await this.redis.get(this.toolSetKey(operationId));
    if (!json) return;
    const toolSet = freezeToolSet(JSON.parse(json));
    if (cache) cache.toolSet = toolSet;
    (state as { operationToolSet?: unknown }).operationToolSet = toolSet;
  }

  /**
   * Save Agent state
   */
  async saveAgentState(operationId: string, state: AgentState): Promise<void> {
    const stateKey = `${this.STATE_PREFIX}:${operationId}`;

    try {
      const slim = await resolveSlim(state.origin?.userId);
      await this.externalizeToolSet(operationId, state);
      const serializedState = this.serializeStateForPersist(state, slim);
      // One MULTI, like `saveStepResult`: `loadAgentStatus` reads the status
      // from the metadata hash, so it must never disagree with the blob.
      const pipeline = this.redis.multi();
      pipeline.setex(stateKey, this.DEFAULT_TTL, serializedState);
      // Keep the externalized tool set alive in lockstep with the blob so a
      // long run never loads a stripped blob whose tool set has expired.
      pipeline.expire(this.toolSetKey(operationId), this.DEFAULT_TTL);
      const metaKey = `${this.METADATA_PREFIX}:${operationId}`;
      const metadata: Partial<AgentOperationMetadata> = {
        lastActiveAt: new Date().toISOString(),
        status: state.status,
        totalCost: state.cost?.total || 0,
        totalSteps: getLlmCallCount(state),
      };
      pipeline.hmset(metaKey, metadata as any);
      pipeline.expire(metaKey, this.DEFAULT_TTL);
      await pipeline.exec();

      // State change events are recorded through the events array in saveStepResult

      log('[%s] Saved state for step %d', operationId, state.stepCount);
    } catch (error) {
      console.error('Failed to save agent state:', error);
      throw error;
    }
  }

  /**
   * Load Agent state
   */
  async loadAgentState(operationId: string): Promise<AgentState | null> {
    const stateKey = `${this.STATE_PREFIX}:${operationId}`;

    try {
      const serializedState = await this.redis.get(stateKey);

      if (!serializedState) {
        return null;
      }

      // Blobs written before the typed `world` / `binding` slots existed carry
      // that context in `metadata`; lift it once here so readers see one shape.
      const state = normalizeAgentState(JSON.parse(serializedState) as AgentState);
      await this.rehydrateToolSet(operationId, state);
      // Unconditional, like the tool set: a blob saved with slimming on loads the
      // same whatever the flag says now.
      restoreSlimState(state);
      log('[%s] Loaded state (step %d)', operationId, state.stepCount);

      return state;
    } catch (error) {
      console.error('Failed to load agent state:', error);
      throw error;
    }
  }

  /**
   * Read only the persisted status. Both save paths write it to the metadata
   * hash in the same MULTI as the blob, so this is the blob's status without
   * downloading the blob, which can run to hundreds of KB. Falls back to the blob
   * only when the hash has no status field.
   */
  async loadAgentStatus(operationId: string): Promise<AgentState['status'] | null> {
    const status = await this.redis.hget(`${this.METADATA_PREFIX}:${operationId}`, 'status');
    if (status) return status as AgentState['status'];
    return (await this.loadAgentState(operationId))?.status ?? null;
  }

  /**
   * Set the interrupt sentinel. The full state blob can run to hundreds of
   * KB (tool manifests, user memory, …), so the step-abort poller checks
   * this tiny key instead of re-downloading the blob every interval — the
   * blob's `status: 'interrupted'` stays the authoritative record.
   */
  async markInterrupted(operationId: string): Promise<void> {
    await this.redis.setex(`${this.INTERRUPT_PREFIX}:${operationId}`, this.DEFAULT_TTL, '1');
  }

  /**
   * Check the interrupt sentinel without loading the state blob.
   */
  async isInterrupted(operationId: string): Promise<boolean> {
    const exists = await this.redis.exists(`${this.INTERRUPT_PREFIX}:${operationId}`);
    return exists === 1;
  }

  /**
   * Mirror the client's queued-messages flag into a tiny key beside the state,
   * for the same reason as the interrupt sentinel: the step boundary reads it
   * without loading the state blob. Clearing deletes the key.
   */
  async setQueuedMessages(operationId: string, pending: boolean): Promise<void> {
    const key = `${this.QUEUED_MESSAGES_PREFIX}:${operationId}`;
    if (pending) await this.redis.setex(key, this.DEFAULT_TTL, '1');
    else await this.redis.del(key);
  }

  async hasQueuedMessages(operationId: string): Promise<boolean> {
    const exists = await this.redis.exists(`${this.QUEUED_MESSAGES_PREFIX}:${operationId}`);
    return exists === 1;
  }

  /**
   * Save step execution result
   */
  async saveStepResult(operationId: string, stepResult: StepResult): Promise<void> {
    try {
      // Write-once before opening the pipeline; the inline loop warms the cache
      // on its first step and every later step skips the tool-set write.
      const slim = await resolveSlim(stepResult.newState.origin?.userId);
      await this.externalizeToolSet(operationId, stepResult.newState);

      const pipeline = this.redis.multi();

      // Save latest state
      const stateKey = `${this.STATE_PREFIX}:${operationId}`;
      pipeline.setex(
        stateKey,
        this.DEFAULT_TTL,
        this.serializeStateForPersist(stepResult.newState, slim),
      );
      // Refresh the externalized tool set's TTL alongside the blob.
      pipeline.expire(this.toolSetKey(operationId), this.DEFAULT_TTL);

      // Save step history
      const stepsKey = `${this.STEPS_PREFIX}:${operationId}`;
      const stepData = {
        context: stepResult.nextContext,
        cost: stepResult.newState.cost?.total || 0,
        executionTime: stepResult.executionTime,
        status: stepResult.newState.status,
        stepIndex: stepResult.stepIndex,
        timestamp: Date.now(),
      };

      pipeline.lpush(stepsKey, JSON.stringify(stepData));
      pipeline.ltrim(stepsKey, 0, 199); // Keep most recent 200 steps
      pipeline.expire(stepsKey, this.DEFAULT_TTL);

      // `stepResult.events` is intentionally NOT persisted: nothing ever read
      // the `agent_runtime_events` list back — the same events already reach
      // clients through the live stream and land durably in the operation
      // trace, so the list only duplicated every streamed byte into Redis.

      // Update operation metadata
      const metaKey = `${this.METADATA_PREFIX}:${operationId}`;
      const metadata: Partial<AgentOperationMetadata> = {
        lastActiveAt: new Date().toISOString(),
        status: stepResult.newState.status,
        totalCost: stepResult.newState.cost?.total || 0,
        totalSteps: getLlmCallCount(stepResult.newState),
      };
      pipeline.hmset(metaKey, metadata as any);
      pipeline.expire(metaKey, this.DEFAULT_TTL);

      await pipeline.exec();

      log('[%s:%d] Saved step result', operationId, stepResult.stepIndex);
    } catch (error) {
      console.error('Failed to save step result:', error);
      throw error;
    }
  }

  /**
   * Get execution history
   */
  async getExecutionHistory(operationId: string, limit: number = 50): Promise<any[]> {
    const stepsKey = `${this.STEPS_PREFIX}:${operationId}`;

    try {
      const history = await this.redis.lrange(stepsKey, 0, limit - 1);
      return history.map((item) => JSON.parse(item)).reverse(); // Earliest first
    } catch (error) {
      console.error('Failed to get execution history:', error);
      return [];
    }
  }

  /**
   * Get operation metadata
   */
  async getOperationMetadata(operationId: string): Promise<AgentOperationMetadata | null> {
    const metaKey = `${this.METADATA_PREFIX}:${operationId}`;

    try {
      const metadata = await this.redis.hgetall(metaKey);

      if (Object.keys(metadata).length === 0) {
        return null;
      }

      return {
        acceptsMemberRuntimeEnd: metadata.acceptsMemberRuntimeEnd === 'true' || undefined,
        agentConfig: metadata.agentConfig ? JSON.parse(metadata.agentConfig) : undefined,
        createdAt: metadata.createdAt,
        lastActiveAt: metadata.lastActiveAt,
        modelRuntimeConfig: metadata.modelRuntimeConfig
          ? JSON.parse(metadata.modelRuntimeConfig)
          : undefined,
        mirrorToOperationId: metadata.mirrorToOperationId || undefined,
        status: metadata.status as AgentState['status'],
        streamOwnerUserId: metadata.streamOwnerUserId || undefined,
        totalCost: parseFloat(metadata.totalCost) || 0,
        totalSteps: parseInt(metadata.totalSteps) || 0,
        userId: metadata.userId,
        workspaceId: metadata.workspaceId,
      };
    } catch (error) {
      console.error('Failed to get operation metadata:', error);
      return null;
    }
  }

  /**
   * Create new operation metadata
   */
  async createOperationMetadata(
    operationId: string,
    data: {
      acceptsMemberRuntimeEnd?: boolean;
      agentConfig?: any;
      mirrorToOperationId?: string;
      modelRuntimeConfig?: any;
      streamOwnerUserId?: string;
      userId?: string;
      workspaceId?: string;
    },
  ): Promise<void> {
    const metaKey = `${this.METADATA_PREFIX}:${operationId}`;

    try {
      const metadata: AgentOperationMetadata = {
        acceptsMemberRuntimeEnd: data.acceptsMemberRuntimeEnd,
        agentConfig: data.agentConfig,
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        mirrorToOperationId: data.mirrorToOperationId,
        modelRuntimeConfig: data.modelRuntimeConfig,
        status: 'idle',
        streamOwnerUserId: data.streamOwnerUserId,
        totalCost: 0,
        totalSteps: 0,
        userId: data.userId,
        workspaceId: data.workspaceId,
      };

      // Serialize complex objects
      const redisData: Record<string, string> = {
        createdAt: metadata.createdAt,
        lastActiveAt: metadata.lastActiveAt,
        status: metadata.status,
        totalCost: metadata.totalCost.toString(),
        totalSteps: metadata.totalSteps.toString(),
      };

      if (metadata.userId) redisData.userId = metadata.userId;
      if (metadata.streamOwnerUserId) redisData.streamOwnerUserId = metadata.streamOwnerUserId;
      if (metadata.workspaceId) redisData.workspaceId = metadata.workspaceId;
      if (metadata.mirrorToOperationId)
        redisData.mirrorToOperationId = metadata.mirrorToOperationId;
      if (metadata.acceptsMemberRuntimeEnd) redisData.acceptsMemberRuntimeEnd = 'true';
      if (metadata.modelRuntimeConfig)
        redisData.modelRuntimeConfig = JSON.stringify(metadata.modelRuntimeConfig);
      if (metadata.agentConfig) redisData.agentConfig = JSON.stringify(metadata.agentConfig);

      await this.redis.hmset(metaKey, redisData);
      await this.redis.expire(metaKey, this.DEFAULT_TTL);

      log('[%s] Created operation metadata', operationId);
    } catch (error) {
      console.error('Failed to create operation metadata:', error);
      throw error;
    }
  }

  /**
   * Delete all data for Agent operation
   */
  async deleteAgentOperation(operationId: string): Promise<void> {
    const keys = [
      `${this.STATE_PREFIX}:${operationId}`,
      this.toolSetKey(operationId),
      `${this.STEPS_PREFIX}:${operationId}`,
      `${this.METADATA_PREFIX}:${operationId}`,
      `${this.INTERRUPT_PREFIX}:${operationId}`,
      `${this.QUEUED_MESSAGES_PREFIX}:${operationId}`,
      `${this.INLINE_RESUME_PREFIX}:${operationId}`,
    ];

    try {
      this.invalidateToolSetCache(operationId);
      await this.redis.del(...keys);
      log('Deleted operation %s', operationId);
    } catch (error) {
      console.error('Failed to delete agent operation:', error);
      throw error;
    }
  }

  /**
   * Get all active operations
   */
  async getActiveOperations(): Promise<string[]> {
    try {
      const pattern = `${this.STATE_PREFIX}:*`;
      const keys = await this.redis.keys(pattern);
      return keys.map((key) => key.replace(`${this.STATE_PREFIX}:`, ''));
    } catch (error) {
      console.error('Failed to get active operations:', error);
      return [];
    }
  }

  /**
   * Clean up expired operation data
   */
  async cleanupExpiredOperations(): Promise<number> {
    try {
      const activeOperations = await this.getActiveOperations();
      let cleanedCount = 0;

      for (const operationId of activeOperations) {
        const metadata = await this.getOperationMetadata(operationId);

        if (metadata) {
          const lastActiveTime = new Date(metadata.lastActiveAt).getTime();
          const now = Date.now();
          const hoursSinceActive = (now - lastActiveTime) / (1000 * 60 * 60);

          // Clean up operations inactive for more than 2 hours
          if (hoursSinceActive > 2) {
            await this.deleteAgentOperation(operationId);
            cleanedCount++;
          }
        }
      }

      log('Cleaned up %d expired operations', cleanedCount);
      return cleanedCount;
    } catch (error) {
      console.error('Failed to cleanup expired operations:', error);
      return 0;
    }
  }

  /**
   * Get statistics
   */
  async getStats(): Promise<{
    activeOperations: number;
    completedOperations: number;
    errorOperations: number;
    totalOperations: number;
  }> {
    try {
      const operations = await this.getActiveOperations();
      const stats = {
        activeOperations: 0,
        completedOperations: 0,
        errorOperations: 0,
        totalOperations: operations.length,
      };

      for (const operationId of operations) {
        const metadata = await this.getOperationMetadata(operationId);

        if (metadata) {
          switch (metadata.status) {
            case 'running':
            case 'waiting_for_human': {
              stats.activeOperations++;
              break;
            }
            case 'done': {
              stats.completedOperations++;
              break;
            }
            case 'error':
            case 'interrupted': {
              stats.errorOperations++;
              break;
            }
          }
        }
      }

      return stats;
    } catch (error) {
      console.error('Failed to get stats:', error);
      return {
        activeOperations: 0,
        completedOperations: 0,
        errorOperations: 0,
        totalOperations: 0,
      };
    }
  }

  /**
   * The inline step loop's envelope for the step it is about to run. This is the
   * queue message that would otherwise be in flight — parked here instead, so a
   * redelivery arriving after the loop died can pick the operation back up from
   * where it actually stopped rather than from the delivered (older) step index.
   */
  async saveInlineResume(operationId: string, serialized: string): Promise<boolean> {
    try {
      await this.redis.setex(
        `${this.INLINE_RESUME_PREFIX}:${operationId}`,
        this.DEFAULT_TTL,
        serialized,
      );
      return true;
    } catch (error) {
      // Reported, never swallowed: the caller must fall back to the queue, or
      // it would run the next step with no recovery path behind it at all.
      console.error('Failed to save inline resume pointer:', error);
      return false;
    }
  }

  /**
   * Deliberately not wrapped in a try/catch. "No envelope" and "could not read
   * the envelope" have opposite consequences: the first means run the delivered
   * step, the second means an operation may be mid-loop with nothing queued
   * behind it. Swallowing the error would ACK that delivery as stale and strand
   * the run, so the failure propagates and the queue retries instead.
   */
  async loadInlineResume(operationId: string): Promise<null | string> {
    return this.redis.get(`${this.INLINE_RESUME_PREFIX}:${operationId}`);
  }

  /**
   * Owner-scoped, and best-effort on failure: a stale envelope is harmless. It
   * only ever resumes a step whose index is ahead of the delivered one, and the
   * next step to park overwrites it — worst case it expires with the
   * operation's TTL. Deleting someone else's envelope is not harmless, hence
   * the ownership check.
   */
  async clearInlineResume(operationId: string, ownerId: string): Promise<void> {
    try {
      await this.redis.eval(
        CLEAR_OWNED_INLINE_RESUME_SCRIPT,
        2,
        this.executionLockKey(operationId),
        `${this.INLINE_RESUME_PREFIX}:${operationId}`,
        ownerId,
      );
    } catch (error) {
      console.error('Failed to clear inline resume pointer:', error);
    }
    this.invalidateToolSetCache(operationId, ownerId);
  }

  private executionLockKey(operationId: string): string {
    return `agent_runtime_operation_lock:${operationId}`;
  }

  async tryClaimStep(
    operationId: string,
    _stepIndex: number,
    ttlSeconds: number = 35,
    ownerId: string = Date.now().toString(),
  ): Promise<boolean> {
    try {
      const result = await this.redis.eval(
        CLAIM_OR_REENTER_LOCK_SCRIPT,
        1,
        this.executionLockKey(operationId),
        ownerId,
        ttlSeconds.toString(),
      );

      const claimed = result === 1;
      if (!claimed) this.invalidateToolSetCache(operationId, ownerId);
      return claimed;
    } catch (error) {
      // Fail-open: on Redis error, allow execution to proceed
      console.error('Failed to acquire step lock:', error);
      return true;
    }
  }

  async refreshStepLock(
    operationId: string,
    _stepIndex: number,
    ttlSeconds: number,
    ownerId?: string,
  ): Promise<boolean> {
    try {
      const key = this.executionLockKey(operationId);
      if (!ownerId) {
        return (await this.redis.expire(key, ttlSeconds)) === 1;
      }

      const result = await this.redis.eval(
        REFRESH_OWNED_LOCK_SCRIPT,
        1,
        key,
        ownerId,
        ttlSeconds.toString(),
      );

      const owned = result === 1;
      if (!owned) this.invalidateToolSetCache(operationId, ownerId);
      return owned;
    } catch (error) {
      console.error('Failed to refresh step lock:', error);
      return false;
    }
  }

  async releaseStepLock(operationId: string, _stepIndex: number, ownerId?: string): Promise<void> {
    try {
      const key = this.executionLockKey(operationId);
      if (!ownerId) {
        await this.redis.del(key);
        return;
      }

      await this.redis.eval(RELEASE_OWNED_LOCK_SCRIPT, 1, key, ownerId);
      this.invalidateToolSetCache(operationId, ownerId);
    } catch (error) {
      console.error('Failed to release step lock:', error);
    }
  }

  /**
   * Close Redis connection
   */
  async disconnect(): Promise<void> {
    this.toolSetExecutionCaches.clear();
    await this.redis.quit();
  }
}
