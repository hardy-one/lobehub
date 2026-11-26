import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerFeatureFlagsStateFromRuntimeConfig } from '@/server/featureFlags';

import { AgentStateManager, resetSlimAgentStateCache } from '../AgentStateManager';

// Mock Redis client. Hoisted so individual tests can assert on the exact
// payloads handed to `setex` / `lpush`.
const { redisMock, pipelineMock } = vi.hoisted(() => {
  const pipelineMock = {
    exec: vi.fn(),
    expire: vi.fn(),
    hmset: vi.fn(),
    lpush: vi.fn(),
    ltrim: vi.fn(),
    setex: vi.fn(),
  };
  const redisMock = {
    del: vi.fn(),
    eval: vi.fn(),
    exists: vi.fn(),
    expire: vi.fn(),
    get: vi.fn(),
    hget: vi.fn(),
    hgetall: vi.fn(),
    hmset: vi.fn(),
    keys: vi.fn(),
    mget: vi.fn(),
    multi: vi.fn(() => pipelineMock),
    quit: vi.fn(),
    set: vi.fn(),
    setex: vi.fn(),
  };
  return { pipelineMock, redisMock };
});

vi.mock('../redis', () => ({
  getAgentRuntimeRedisClient: () => redisMock,
}));

vi.mock('@/server/featureFlags', () => ({
  getServerFeatureFlagsStateFromRuntimeConfig: vi.fn(),
}));

const mockSlimFlag = (enabled: boolean) =>
  vi
    .mocked(getServerFeatureFlagsStateFromRuntimeConfig)
    .mockResolvedValue({ enableSlimAgentState: enabled } as any);

describe('AgentStateManager', () => {
  let stateManager: AgentStateManager;

  beforeEach(() => {
    vi.clearAllMocks();
    redisMock.eval.mockResolvedValue(1);
    resetSlimAgentStateCache();
    mockSlimFlag(false);
    stateManager = new AgentStateManager();
  });

  describe('createOperationMetadata', () => {
    it('should create operation metadata successfully', async () => {
      const operationId = 'test-operation-id';
      const data = {
        agentConfig: { test: true },
        modelRuntimeConfig: { model: 'gpt-4' },
        userId: 'user-123',
      };

      await expect(stateManager.createOperationMetadata(operationId, data)).resolves.not.toThrow();
    });

    it('round-trips the client member_runtime_end declaration', async () => {
      await stateManager.createOperationMetadata('op-supervisor', {
        acceptsMemberRuntimeEnd: true,
        userId: 'user-123',
      });
      const stored = redisMock.hmset.mock.calls.at(-1)?.[1] as Record<string, string>;
      expect(stored.acceptsMemberRuntimeEnd).toBe('true');

      redisMock.hgetall.mockResolvedValueOnce(stored);
      const meta = await stateManager.getOperationMetadata('op-supervisor');
      expect(meta?.acceptsMemberRuntimeEnd).toBe(true);

      redisMock.hgetall.mockResolvedValueOnce({ ...stored, acceptsMemberRuntimeEnd: undefined });
      expect((await stateManager.getOperationMetadata('op-old'))?.acceptsMemberRuntimeEnd).toBe(
        undefined,
      );
    });
  });

  describe('saveAgentState', () => {
    it('should save agent state successfully', async () => {
      const operationId = 'test-operation-id';
      const state = {
        cost: { total: 100 },
        status: 'done' as const,
        stepCount: 5,
      };

      await expect(stateManager.saveAgentState(operationId, state as any)).resolves.not.toThrow();
    });

    it('should save agent state with running status', async () => {
      const operationId = 'test-operation-id';
      const state = {
        cost: { total: 50 },
        status: 'running' as const,
        stepCount: 3,
      };

      await expect(stateManager.saveAgentState(operationId, state as any)).resolves.not.toThrow();
    });

    it('writes the status to the metadata hash in the same MULTI as the blob', async () => {
      await stateManager.saveAgentState('op-meta', {
        cost: { total: 2 },
        status: 'interrupted',
        stepCount: 3,
      } as any);

      expect(redisMock.multi).toHaveBeenCalledTimes(1);
      expect(pipelineMock.setex).toHaveBeenCalledWith(
        'agent_runtime_state:op-meta',
        2 * 3600,
        expect.any(String),
      );
      expect(pipelineMock.hmset).toHaveBeenCalledWith(
        'agent_runtime_meta:op-meta',
        expect.objectContaining({ status: 'interrupted', totalCost: 2 }),
      );
      expect(pipelineMock.exec).toHaveBeenCalledTimes(1);
      expect(redisMock.setex).not.toHaveBeenCalled();
      expect(redisMock.hmset).not.toHaveBeenCalled();
    });

    it('omits the messages array from the persisted state blob', async () => {
      const state = {
        cost: { total: 1 },
        messages: [{ content: 'x'.repeat(1000), id: 'msg-1', role: 'user' }],
        origin: { agentId: 'agent-1', topicId: 'topic-1' },
        status: 'running' as const,
        stepCount: 1,
      };

      await stateManager.saveAgentState('op-strip', state as any);

      const serialized = pipelineMock.setex.mock.calls.at(-1)?.[2] as string;
      expect(JSON.parse(serialized).messages).toBeUndefined();
      // Other fields are retained.
      expect(JSON.parse(serialized).status).toBe('running');
    });

    it.each([undefined, { agentId: 'agent-1' }, { topicId: 'topic-1' }])(
      'keeps private transcripts without a rehydratable origin: %j',
      async (origin) => {
        const messages = [{ content: 'private transcript', id: 'private-1', role: 'user' }];
        const state = { messages, origin, status: 'running', stepCount: 1 };
        await stateManager.saveAgentState('private-op', state as any);
        const serialized = pipelineMock.setex.mock.calls.at(-1)?.[2] as string;
        expect(JSON.parse(serialized).messages).toEqual(messages);

        await stateManager.saveStepResult('private-op', {
          executionTime: 1,
          newState: state as any,
          stepIndex: 1,
        });
        const stepState = pipelineMock.setex.mock.calls.at(-1)?.[2] as string;
        expect(JSON.parse(stepState).messages).toEqual(messages);
      },
    );

    it('keeps the full messages array when an ephemeral (id-less) message is present', async () => {
      const state = {
        cost: { total: 1 },
        messages: [
          { content: 'persisted history', id: 'msg-1', role: 'user' },
          // ephemeral supervisor instruction — never written to the DB (no id)
          { content: 'respond to the group', role: 'user' },
        ],
        status: 'running' as const,
        stepCount: 1,
      };

      await stateManager.saveAgentState('op-ephemeral', state as any);

      const serialized = pipelineMock.setex.mock.calls.at(-1)?.[2] as string;
      const persisted = JSON.parse(serialized);
      expect(persisted.messages).toHaveLength(2);
      expect(persisted.messages[1].content).toBe('respond to the group');
    });
  });

  describe('loadAgentStatus', () => {
    it('reads the status from the metadata hash without loading the blob', async () => {
      redisMock.hget.mockResolvedValueOnce('interrupted');

      await expect(stateManager.loadAgentStatus('op-status')).resolves.toBe('interrupted');
      expect(redisMock.hget).toHaveBeenCalledWith('agent_runtime_meta:op-status', 'status');
      expect(redisMock.get).not.toHaveBeenCalled();
    });

    it('falls back to the blob when the hash has no status', async () => {
      redisMock.hget.mockResolvedValueOnce(null);
      redisMock.get.mockResolvedValueOnce(JSON.stringify({ status: 'done', stepCount: 2 }));

      await expect(stateManager.loadAgentStatus('op-legacy')).resolves.toBe('done');
      expect(redisMock.get).toHaveBeenCalledWith('agent_runtime_state:op-legacy');
    });

    it('returns null when neither the hash nor the blob exists', async () => {
      redisMock.hget.mockResolvedValueOnce(null);
      redisMock.get.mockResolvedValueOnce(null);

      await expect(stateManager.loadAgentStatus('op-missing')).resolves.toBeNull();
    });
  });

  describe('saveStepResult', () => {
    it('should save step result successfully when status is done', async () => {
      const operationId = 'test-operation-id';
      const stepResult = {
        executionTime: 1000,
        newState: {
          cost: { total: 200 },
          status: 'done' as const,
          stepCount: 10,
        },
        stepIndex: 10,
      };

      await expect(
        stateManager.saveStepResult(operationId, stepResult as any),
      ).resolves.not.toThrow();
    });

    it('should save step result successfully when status is not done', async () => {
      const operationId = 'test-operation-id';
      const stepResult = {
        executionTime: 500,
        newState: {
          cost: { total: 75 },
          status: 'running' as const,
          stepCount: 3,
        },
        stepIndex: 3,
      };

      await expect(
        stateManager.saveStepResult(operationId, stepResult as any),
      ).resolves.not.toThrow();
    });

    it('strips messages from the persisted state and never persists step events', async () => {
      const stepResult = {
        events: [
          {
            finalState: {
              messages: [{ content: 'big assistant answer', role: 'assistant' }],
              status: 'done',
            },
            reason: 'completed',
            type: 'done',
          },
        ],
        executionTime: 1,
        newState: {
          cost: { total: 1 },
          messages: [{ content: 'x'.repeat(1000), id: 'msg-1', role: 'user' }],
          origin: { agentId: 'agent-1', topicId: 'topic-1' },
          status: 'done' as const,
          stepCount: 1,
        },
        stepIndex: 1,
      };

      await stateManager.saveStepResult('op-strip-step', stepResult as any);

      const stateValue = pipelineMock.setex.mock.calls.at(-1)?.[2] as string;
      expect(JSON.parse(stateValue).messages).toBeUndefined();

      // Events reach clients via the live stream and land in the operation
      // trace; the Redis list they used to fill had no readers.
      const lpushKeys = pipelineMock.lpush.mock.calls.map((c) => c[0] as string);
      expect(lpushKeys).toEqual(['agent_runtime_steps:op-strip-step']);
    });
  });

  // The tool set is immutable, the heaviest thing on the state, and re-written
  // at every step; it lives in its own key and is re-attached on load. Each
  // execution binds an owner-scoped cache via `withToolSetCache`.
  describe('operationToolSet externalization', () => {
    const toolSet = { enabledToolIds: ['foo'], manifestMap: { foo: { api: [] } }, tools: [{}] };
    const cacheOf = (manager: AgentStateManager, op: string) =>
      (manager as any).toolSetExecutionCaches.get(op) as
        { ownerId: string; revision?: string; toolSet?: unknown } | undefined;
    const cacheSnapshot = (manager: AgentStateManager, op: string) => {
      const cache = cacheOf(manager, op);
      return { present: !!cache, ownerId: cache?.ownerId, warm: !!cache?.toolSet };
    };

    const stateBlobFor = (op: string) =>
      pipelineMock.setex.mock.calls.find((call) => call[0] === `agent_runtime_state:${op}`)?.[2];
    it('writes the tool set to its own key and strips it from the state blob', async () => {
      const state = {
        operationToolSet: toolSet,
        status: 'running',
        stepCount: 1,
      } as any;
      await stateManager.saveAgentState('op-ots-strip', state);

      expect(redisMock.setex).toHaveBeenCalledWith(
        'agent_runtime_toolset:op-ots-strip',
        2 * 3600,
        JSON.stringify(toolSet),
      );
      const blob = pipelineMock.setex.mock.calls.find(
        (c) => c[0] === 'agent_runtime_state:op-ots-strip',
      );
      expect(JSON.parse(blob![2] as string).operationToolSet).toBeUndefined();
      expect(JSON.parse(blob![2] as string).status).toBe('running');
      const blobText = blob![2] as string;
      const fullSize = JSON.stringify(state).length;
      console.log(
        `[probe] stateBlobBytes=${Buffer.byteLength(blobText)} fullStateBytes=${Buffer.byteLength(JSON.stringify(state))} toolSetBytes=${Buffer.byteLength(JSON.stringify(toolSet))} containsToolSetField=${blobText.includes('operationToolSet')}`,
      );
      expect(blobText).not.toContain('operationToolSet');
      expect(blobText.length).toBeLessThan(fullSize);
    });

    it('writes the tool set once per execution and only refreshes its TTL after that', async () => {
      const op = 'op-ots-once';
      const state = { operationToolSet: toolSet, status: 'running', stepCount: 1 } as any;
      const dispose = stateManager.withToolSetCache(op, 'owner-once');
      try {
        await stateManager.saveAgentState(op, state);
        await stateManager.saveAgentState(op, state);
      } finally {
        dispose();
      }

      const writes = redisMock.setex.mock.calls.filter(
        (c) => c[0] === `agent_runtime_toolset:${op}`,
      );
      expect(writes).toHaveLength(1);
      expect(pipelineMock.expire).toHaveBeenCalledWith(`agent_runtime_toolset:${op}`, 2 * 3600);
    });

    it('refreshes the tool-set TTL inside the step pipeline and strips the blob', async () => {
      const op = 'op-ots-step';
      await stateManager.saveStepResult(op, {
        executionTime: 1,
        newState: { operationToolSet: toolSet, status: 'running', stepCount: 1 },
        stepIndex: 1,
      } as any);

      expect(redisMock.setex).toHaveBeenCalledWith(
        `agent_runtime_toolset:${op}`,
        2 * 3600,
        JSON.stringify(toolSet),
      );
      expect(pipelineMock.expire).toHaveBeenCalledWith(`agent_runtime_toolset:${op}`, 2 * 3600);
      const blob = pipelineMock.setex.mock.calls.find((c) => c[0] === `agent_runtime_state:${op}`);
      expect(JSON.parse(blob![2] as string).operationToolSet).toBeUndefined();
    });

    it('writes again when a saved tool set changes', async () => {
      const op = 'op-ots-change';
      const state = {
        operationToolSet: structuredClone(toolSet),
        status: 'running',
        stepCount: 1,
      } as any;
      const dispose = stateManager.withToolSetCache(op, 'owner-change');
      try {
        await stateManager.saveAgentState(op, state);
        state.operationToolSet = structuredClone(state.operationToolSet);
        state.operationToolSet.enabledToolIds.push('bar');
        await stateManager.saveAgentState(op, state);
      } finally {
        dispose();
      }
      expect(
        redisMock.setex.mock.calls.filter(([key]) => key === `agent_runtime_toolset:${op}`),
      ).toHaveLength(2);
    });

    it('re-attaches the tool set from its key when the loaded blob has none', async () => {
      const op = 'op-ots-load';
      redisMock.get.mockImplementation((key: string) =>
        key === `agent_runtime_state:${op}`
          ? JSON.stringify({ status: 'running', stepCount: 2 })
          : key === `agent_runtime_toolset:${op}`
            ? JSON.stringify(toolSet)
            : null,
      );
      const loaded = await stateManager.loadAgentState(op);
      expect(loaded?.operationToolSet).toEqual(toolSet);
    });

    it('keeps one write and zero per-step stringify across N inline steps', async () => {
      const op = 'op-ots-inline-counts';
      const stepCount = 8;
      const serializedTools = JSON.stringify(toolSet);
      redisMock.get.mockImplementation((key: string) =>
        key === `agent_runtime_state:${op}`
          ? JSON.stringify({ status: 'running', stepCount: 1 })
          : key === `agent_runtime_toolset:${op}`
            ? serializedTools
            : null,
      );
      const stringify = vi.spyOn(JSON, 'stringify');
      const parse = vi.spyOn(JSON, 'parse');
      const setex = vi.spyOn(redisMock, 'setex');
      const get = vi.spyOn(redisMock, 'get');
      const serializedState = JSON.stringify({ status: 'running', stepCount: 1 });
      redisMock.get.mockImplementation((key: string) => {
        if (key === `agent_runtime_state:${op}`) return serializedState;
        if (key === `agent_runtime_toolset:${op}`) return serializedTools;
        return null;
      });
      const dispose = stateManager.withToolSetCache(op, 'owner-inline');
      const toolSetStringifies = () =>
        stringify.mock.calls.filter(([value]) => value === toolSet).length;
      const toolSetWrites = () =>
        setex.mock.calls.filter(([key]) => key === `agent_runtime_toolset:${op}`).length;
      const toolSetReads = () =>
        get.mock.calls.filter(([key]) => key === `agent_runtime_toolset:${op}`).length;
      console.log(
        `[probe:inline] op=${op} steps=${stepCount} cacheBefore=${JSON.stringify(cacheSnapshot(stateManager, op))}`,
      );
      try {
        // Step 1 is the cold write: the operation was just created with a tool
        // set but nothing in Redis yet. Subsequent inline steps load the same
        // frozen object from the cache and save it unchanged.
        await stateManager.saveStepResult(op, {
          executionTime: 1,
          newState: {
            operationToolSet: toolSet,
            status: 'running',
            stepCount: 1,
          } as any,
          stepIndex: 1,
        });
        console.log(
          `[probe:inline] step=0-cold-write stringifyToolSet=${toolSetStringifies()} parseToolSet=${parse.mock.calls.filter(([value]) => value === serializedTools).length} setexToolSet=${toolSetWrites()} cache=${JSON.stringify(cacheSnapshot(stateManager, op))}`,
        );
        const loaded = [];
        for (let step = 1; step <= stepCount; step++) {
          // Each state carries the frozen object cached on cold load, the way an
          // inline step does. A brand-new equal object is a separate case below.
          loaded.push(await stateManager.loadAgentState(op));
          const state = {
            ...loaded.at(-1)!,
            status: 'running',
            stepCount: step + 1,
          } as any;
          await stateManager.saveStepResult(op, {
            executionTime: 1,
            newState: state,
            stepIndex: step + 1,
          });
          console.log(
            `[probe:inline] step=${step} stringifyToolSet=${toolSetStringifies()} stringifyTotal=${stringify.mock.calls.length} parseToolSet=${parse.mock.calls.filter(([value]) => value === serializedTools).length} setexToolSet=${toolSetWrites()} cache=${JSON.stringify(cacheSnapshot(stateManager, op))}`,
          );
        }
        expect(loaded.map((state) => state!.operationToolSet)).toEqual(
          Array.from({ length: stepCount }, () => toolSet),
        );
        for (const state of loaded)
          expect(state!.operationToolSet).toBe(loaded[0]!.operationToolSet);
        expect(Object.isFrozen(loaded[0]!.operationToolSet)).toBe(true);
        expect(Object.isFrozen((loaded[0]!.operationToolSet as any).manifestMap.foo)).toBe(true);
        expect(toolSetWrites()).toBe(1);
        expect(toolSetStringifies()).toBe(1);
        // One cold read and one parse for a new owner in the same process; this
        // is the snapshot reused by the inline steps above.
        const cold = new AgentStateManager();
        const coldOp = `${op}-cold`;
        const coldDispose = cold.withToolSetCache(coldOp, 'owner-cold');
        const readsBefore = get.mock.calls.length;
        const parsesBefore = parse.mock.calls.length;
        redisMock.get.mockImplementation((key: string) => {
          if (key === `agent_runtime_state:${coldOp}`) return serializedState;
          if (key === `agent_runtime_toolset:${coldOp}`) return serializedTools;
          return null;
        });
        const coldLoaded = await cold.loadAgentState(coldOp);
        coldDispose();
        expect(coldLoaded?.operationToolSet).toEqual(toolSet);
        expect(Object.isFrozen(coldLoaded?.operationToolSet)).toBe(true);
        const coldReads = get.mock.calls
          .slice(readsBefore)
          .filter(([key]) => key === `agent_runtime_toolset:${coldOp}`).length;
        const coldParses = parse.mock.calls
          .slice(parsesBefore)
          .filter(([value]) => value === serializedTools).length;
        console.log(
          `[probe:cold-load] toolSetRedisReads=${coldReads} toolSetJsonParses=${coldParses}`,
        );
        expect(coldReads).toBe(1);
        expect(coldParses).toBe(1);
        const blob = stateBlobFor(op)!;
        expect(blob).not.toContain('operationToolSet');
        console.log(
          `[probe:inline] summary steps=${stepCount} toolSetRedisReads=${toolSetReads()} toolSetJsonParses=${parse.mock.calls.filter(([value]) => value === serializedTools).length} toolSetSetex=${toolSetWrites()} toolSetStringifies=${toolSetStringifies()} frozen=${Object.isFrozen(loaded[0]!.operationToolSet)} blobHasToolSet=${blob.includes('operationToolSet')}`,
        );
      } finally {
        dispose();
        stringify.mockRestore();
        parse.mockRestore();
        setex.mockRestore();
        get.mockRestore();
      }
    });

    it('cold-reads Redis again after a lock handoff and sees the latest value', async () => {
      const op = 'op-ots-handoff';
      const firstValue = JSON.stringify(toolSet);
      const secondValue = JSON.stringify({ ...toolSet, enabledToolIds: ['bar'] });
      const serializedState = JSON.stringify({ status: 'running', stepCount: 1 });
      let currentToolSet = firstValue;
      redisMock.get.mockImplementation((key: string) =>
        key === `agent_runtime_state:${op}`
          ? serializedState
          : key === `agent_runtime_toolset:${op}`
            ? currentToolSet
            : null,
      );
      const parse = vi.spyOn(JSON, 'parse');
      try {
        const disposeA = stateManager.withToolSetCache(op, 'owner-a');
        try {
          expect((await stateManager.loadAgentState(op))!.operationToolSet).toEqual(toolSet);
          currentToolSet = secondValue;
        } finally {
          disposeA();
        }
        const disposeB = stateManager.withToolSetCache(op, 'owner-b');
        try {
          const loaded = await stateManager.loadAgentState(op);
          expect((loaded!.operationToolSet as any).enabledToolIds).toEqual(['bar']);
        } finally {
          disposeB();
        }
        const toolSetReads = redisMock.get.mock.calls.filter(
          ([key]) => key === `agent_runtime_toolset:${op}`,
        );
        const parses = [firstValue, secondValue].map(
          (value) => parse.mock.calls.filter(([arg]) => arg === value).length,
        );
        console.log(
          `[probe] handoff toolSetRedisReads=${toolSetReads.length} parsesByValue=${JSON.stringify(parses)}`,
        );
        expect(toolSetReads).toHaveLength(2);
        expect(parses).toEqual([1, 1]);
      } finally {
        parse.mockRestore();
      }
    });

    it('drops cached state when the lock is lost or released', async () => {
      const op = 'op-ots-lock-loss';
      const firstValue = JSON.stringify(toolSet);
      const secondValue = JSON.stringify({ ...toolSet, enabledToolIds: ['bar'] });
      let currentToolSet = firstValue;
      redisMock.get.mockImplementation((key: string) =>
        key === `agent_runtime_state:${op}`
          ? JSON.stringify({ status: 'running', stepCount: 1 })
          : key === `agent_runtime_toolset:${op}`
            ? currentToolSet
            : null,
      );

      const disposeLock = stateManager.withToolSetCache(op, 'owner-lock');
      try {
        expect((await stateManager.loadAgentState(op))!.operationToolSet).toEqual(toolSet);
        currentToolSet = secondValue;
        redisMock.eval.mockResolvedValueOnce(0);
        expect(await stateManager.refreshStepLock(op, 1, 120, 'owner-lock')).toBe(false);
        expect((await stateManager.loadAgentState(op))!.operationToolSet).toEqual({
          ...toolSet,
          enabledToolIds: ['bar'],
        });
      } finally {
        disposeLock();
      }

      const disposeRelease = stateManager.withToolSetCache(op, 'owner-release');
      try {
        expect((await stateManager.loadAgentState(op))!.operationToolSet).toEqual({
          ...toolSet,
          enabledToolIds: ['bar'],
        });
        currentToolSet = JSON.stringify({ ...toolSet, enabledToolIds: ['baz'] });
      } finally {
        disposeRelease();
      }
      await stateManager.releaseStepLock(op, 1, 'owner-release');
      const disposeRelease2 = stateManager.withToolSetCache(op, 'owner-release-2');
      try {
        expect((await stateManager.loadAgentState(op))!.operationToolSet).toEqual({
          ...toolSet,
          enabledToolIds: ['baz'],
        });
      } finally {
        disposeRelease2();
      }
    });

    it('probes lock loss, acquire failure, release, delete and owner change directly', async () => {
      const serializedState = JSON.stringify({ status: 'running', stepCount: 1 });
      const firstValue = JSON.stringify(toolSet);
      const secondValue = JSON.stringify({ ...toolSet, enabledToolIds: ['bar'] });
      const thirdValue = JSON.stringify({ ...toolSet, enabledToolIds: ['baz'] });
      const fourthValue = JSON.stringify({ ...toolSet, enabledToolIds: ['qux'] });
      const probeManager = new AgentStateManager();
      let currentToolSet = firstValue;
      let deleted = false;
      const client = {
        ...redisMock,
        del: vi.fn(async (...keys: string[]) => {
          if (keys.includes(`agent_runtime_toolset:op-ots-boundaries`)) deleted = true;
          return keys.length;
        }),
        get: vi.fn(async (key: string) => {
          if (key === `agent_runtime_state:op-ots-boundaries`) return serializedState;
          if (key === `agent_runtime_toolset:op-ots-boundaries`)
            return deleted ? null : currentToolSet;
          return null;
        }),
      } as any;
      probeManager['redis'] = client;
      const op = 'op-ots-boundaries';
      const toolSetReads = () =>
        client.get.mock.calls.filter(([key]) => key === `agent_runtime_toolset:${op}`).length;
      const readValue = async () =>
        (await probeManager.loadAgentState(op))!.operationToolSet as any;
      const parseCountFor = (value: string) =>
        parse.mock.calls.filter(([arg]) => arg === value).length;
      const parse = vi.spyOn(JSON, 'parse');

      try {
        const disposeLock = probeManager.withToolSetCache(op, 'owner-lock');
        console.log(
          `[probe:boundary] lock_lost before=${JSON.stringify(cacheSnapshot(probeManager, op))}`,
        );
        await readValue();
        currentToolSet = secondValue;
        redisMock.eval.mockResolvedValueOnce(0);
        const refreshed = await probeManager.refreshStepLock(op, 1, 120, 'owner-lock');
        console.log(
          `[probe:boundary] lock_lost action=refreshStepLock returned=${refreshed} after=${JSON.stringify(cacheSnapshot(probeManager, op))}`,
        );
        const afterLock = await readValue();
        console.log(
          `[probe:boundary] lock_lost redisReads=${toolSetReads()} value=${JSON.stringify(afterLock.enabledToolIds)} parses=${parseCountFor(secondValue)}`,
        );
        disposeLock();

        const disposeAcquire = probeManager.withToolSetCache(op, 'owner-acquire');
        console.log(
          `[probe:boundary] acquire_failed before=${JSON.stringify(cacheSnapshot(probeManager, op))}`,
        );
        await readValue();
        currentToolSet = thirdValue;
        redisMock.eval.mockResolvedValueOnce(0);
        const claimed = await probeManager.tryClaimStep(op, 2, 120, 'owner-acquire');
        console.log(
          `[probe:boundary] acquire_failed action=tryClaimStep returned=${claimed} after=${JSON.stringify(cacheSnapshot(probeManager, op))}`,
        );
        const afterAcquire = await readValue();
        console.log(
          `[probe:boundary] acquire_failed redisReads=${toolSetReads()} value=${JSON.stringify(afterAcquire.enabledToolIds)} parses=${parseCountFor(thirdValue)}`,
        );
        disposeAcquire();

        const disposeRelease = probeManager.withToolSetCache(op, 'owner-release');
        await readValue();
        console.log(
          `[probe:boundary] release_lock before=${JSON.stringify(cacheSnapshot(probeManager, op))}`,
        );
        const readsBeforeRelease = toolSetReads();
        await probeManager.releaseStepLock(op, 3, 'owner-release');
        console.log(
          `[probe:boundary] release_lock action=releaseStepLock after=${JSON.stringify(cacheSnapshot(probeManager, op))}`,
        );
        const afterRelease = await readValue();
        console.log(
          `[probe:boundary] release_lock extraRedisReads=${toolSetReads() - readsBeforeRelease} value=${JSON.stringify(afterRelease.enabledToolIds)}`,
        );
        disposeRelease();

        const disposeDelete = probeManager.withToolSetCache(op, 'owner-delete');
        await readValue();
        console.log(
          `[probe:boundary] delete_operation before=${JSON.stringify(cacheSnapshot(probeManager, op))}`,
        );
        const readsBeforeDelete = toolSetReads();
        await probeManager.deleteAgentOperation(op);
        console.log(
          `[probe:boundary] delete_operation action=deleteAgentOperation after=${JSON.stringify(cacheSnapshot(probeManager, op))} redisKeyDeleted=${deleted}`,
        );
        console.log(
          `[probe:boundary] delete_operation extraRedisReads=${toolSetReads() - readsBeforeDelete} coldReadValue=${JSON.stringify((await probeManager.loadAgentState(op))?.operationToolSet ?? null)}`,
        );
        disposeDelete();

        deleted = false;
        const disposeOldOwner = probeManager.withToolSetCache(op, 'owner-old');
        const stale = await readValue();
        console.log(
          `[probe:boundary] redelivery_owner_change staleValue=${JSON.stringify(stale.enabledToolIds)}`,
        );
        currentToolSet = fourthValue;
        console.log(
          `[probe:boundary] redelivery_owner_change before=${JSON.stringify(cacheSnapshot(probeManager, op))}`,
        );
        disposeOldOwner();
        const disposeNewOwner = probeManager.withToolSetCache(op, 'owner-new');
        const readsBefore = toolSetReads();
        const afterOwner = await readValue();
        console.log(
          `[probe:boundary] redelivery_owner_change action=withToolSetCache(owner-new) after=${JSON.stringify(cacheSnapshot(probeManager, op))} extraRedisReads=${toolSetReads() - readsBefore} value=${JSON.stringify(afterOwner.enabledToolIds)} parses=${parseCountFor(fourthValue)}`,
        );
        disposeNewOwner();

        expect(afterLock.enabledToolIds).toEqual(['bar']);
        expect(afterAcquire.enabledToolIds).toEqual(['baz']);
        expect(cacheOf(probeManager, op)).toBeUndefined();
        expect(afterOwner.enabledToolIds).toEqual(['qux']);
      } finally {
        parse.mockRestore();
      }
    });

    it('does not leak a parsed tool set between two manager instances', async () => {
      const op = 'op-ots-isolation';
      const firstValue = JSON.stringify(toolSet);
      const secondValue = JSON.stringify({ ...toolSet, enabledToolIds: ['bar'] });
      const makeManager = (value: string) => {
        const manager = new AgentStateManager();
        const client = {
          ...redisMock,
          get: vi.fn(async (key: string) =>
            key === `agent_runtime_state:${op}`
              ? JSON.stringify({ status: 'running', stepCount: 1 })
              : key === `agent_runtime_toolset:${op}`
                ? value
                : null,
          ),
        } as any;
        manager['redis'] = client;
        return manager;
      };

      const first = makeManager(firstValue);
      const second = makeManager(secondValue);
      const disposeFirst = first.withToolSetCache(op, 'owner-a');
      const disposeSecond = second.withToolSetCache(op, 'owner-b');
      try {
        expect((await first.loadAgentState(op))!.operationToolSet).toEqual(toolSet);
        expect((await second.loadAgentState(op))!.operationToolSet).toEqual({
          ...toolSet,
          enabledToolIds: ['bar'],
        });
      } finally {
        disposeSecond();
        disposeFirst();
      }
    });

    it('leaves an inline (legacy / rolling-deploy) tool set untouched', async () => {
      const op = 'op-ots-inline';
      const inline = { enabledToolIds: [], manifestMap: { bar: {} }, tools: [] };
      redisMock.get.mockImplementation((key: string) =>
        key === `agent_runtime_state:${op}`
          ? JSON.stringify({ operationToolSet: inline, status: 'running', stepCount: 1 })
          : null,
      );

      const loaded = await stateManager.loadAgentState(op);
      expect(loaded?.operationToolSet).toEqual(inline);
      expect(redisMock.get).not.toHaveBeenCalledWith(`agent_runtime_toolset:${op}`);
    });
  });

  describe('slim state (agent_runtime_slim_state)', () => {
    const manifest = { api: [{ name: 'x' }], identifier: 'x' };
    const toolSet = {
      enabledToolIds: ['x'],
      manifestMap: { x: manifest },
      sourceMap: {},
      tools: [{ function: { name: 'x' } }],
    };
    const expertise = { renderedContext: 'expert' };
    const origin = { userId: 'user-slim' };
    const buildState = () => ({
      activatedStepTools: [{ activatedAtStep: 1, id: 'x', manifest, source: 'discovery' }],
      expertise,
      initialContext: { payload: { tools: toolSet.tools }, phase: 'user_input' },
      operationToolSet: toolSet,
      origin,
      status: 'running',
      stepCount: 2,
      world: { expertise },
    });

    const stepBlob = (op: string) =>
      JSON.parse(
        pipelineMock.setex.mock.calls.find((c) => c[0] === `agent_runtime_state:${op}`)![2],
      );

    beforeEach(() => {
      delete process.env.AGENT_RUNTIME_SLIM_STATE;
    });

    afterAll(() => {
      delete process.env.AGENT_RUNTIME_SLIM_STATE;
    });

    it('leaves the copies out of the step blob when the flag is on', async () => {
      mockSlimFlag(true);
      const op = 'op-slim-on';

      await stateManager.saveStepResult(op, {
        executionTime: 1,
        newState: buildState(),
        stepIndex: 2,
      } as any);

      const blob = stepBlob(op);
      expect(blob.initialContext.payload.tools).toBeUndefined();
      expect(blob.activatedStepTools[0].manifest).toBeUndefined();
      expect(blob.expertise).toBeUndefined();
      expect(blob.world.expertise).toEqual(expertise);
      expect(blob.__slim).toEqual({ activatedManifests: [0], expertise: true, payloadTools: true });
    });

    it('loads a slimmed blob back to the full state', async () => {
      mockSlimFlag(true);
      const op = 'op-slim-load';
      await stateManager.saveStepResult(op, {
        executionTime: 1,
        newState: buildState(),
        stepIndex: 2,
      } as any);
      const stored = pipelineMock.setex.mock.calls.find(
        (c) => c[0] === `agent_runtime_state:${op}`,
      )![2];
      redisMock.get.mockImplementation(async (key: string) =>
        key === `agent_runtime_toolset:${op}` ? JSON.stringify(toolSet) : stored,
      );

      const loaded = await stateManager.loadAgentState(op);

      expect(loaded).toMatchObject(JSON.parse(JSON.stringify(buildState())));
      expect((loaded as any).__slim).toBeUndefined();
    });

    it('keeps the blob unchanged when the flag is off', async () => {
      mockSlimFlag(false);
      const op = 'op-slim-off';
      const { operationToolSet: _toolSet, ...expected } = buildState();

      await stateManager.saveStepResult(op, {
        executionTime: 1,
        newState: buildState(),
        stepIndex: 2,
      } as any);

      expect(stepBlob(op)).toEqual(JSON.parse(JSON.stringify(expected)));
    });

    it("AGENT_RUNTIME_SLIM_STATE='0' overrides an enabled flag", async () => {
      process.env.AGENT_RUNTIME_SLIM_STATE = '0';
      mockSlimFlag(true);
      const op = 'op-slim-env-off';

      await stateManager.saveStepResult(op, {
        executionTime: 1,
        newState: buildState(),
        stepIndex: 2,
      } as any);

      const blob = stepBlob(op);
      expect(blob.__slim).toBeUndefined();
      expect(blob.initialContext.payload.tools).toEqual(toolSet.tools);
      expect(blob.operationToolSet).toBeUndefined();
    });

    it('resolves the flag for the owner once per cache window', async () => {
      mockSlimFlag(true);
      const op = 'op-slim-one-read';

      for (const stepIndex of [2, 3]) {
        await stateManager.saveStepResult(op, {
          executionTime: 1,
          newState: buildState(),
          stepIndex,
        } as any);
      }

      // The per-step write must not pay a flag lookup on every step.
      expect(getServerFeatureFlagsStateFromRuntimeConfig).toHaveBeenCalledWith('user-slim');
      expect(getServerFeatureFlagsStateFromRuntimeConfig).toHaveBeenCalledTimes(1);
    });

    it('resolves the flag per operation owner', async () => {
      mockSlimFlag(true);

      for (const userId of ['user-a', 'user-b']) {
        await stateManager.saveAgentState(`op-slim-owner-${userId}`, {
          ...buildState(),
          origin: { userId },
        } as any);
      }

      expect(getServerFeatureFlagsStateFromRuntimeConfig).toHaveBeenCalledWith('user-a');
      expect(getServerFeatureFlagsStateFromRuntimeConfig).toHaveBeenCalledWith('user-b');
      expect(getServerFeatureFlagsStateFromRuntimeConfig).toHaveBeenCalledTimes(2);
    });

    it('does not slim, and does not cache, a failed resolution', async () => {
      vi.mocked(getServerFeatureFlagsStateFromRuntimeConfig)
        .mockRejectedValueOnce(new Error('down'))
        .mockResolvedValue({ enableSlimAgentState: true } as any);
      const op = 'op-slim-error-retry';

      for (const stepIndex of [2, 3]) {
        await stateManager.saveStepResult(op, {
          executionTime: 1,
          newState: buildState(),
          stepIndex,
        } as any);
      }

      expect(getServerFeatureFlagsStateFromRuntimeConfig).toHaveBeenCalledTimes(2);
      const blobs = pipelineMock.setex.mock.calls
        .filter((c) => c[0] === `agent_runtime_state:${op}`)
        .map((c) => JSON.parse(c[2] as string));
      // The tool set is stripped either way; only the retry is slimmed.
      expect(blobs[0].operationToolSet).toBeUndefined();
      expect(blobs[0].__slim).toBeUndefined();
      expect(blobs.at(-1).__slim).toBeDefined();
    });
  });

  describe('step execution lock', () => {
    it('claims an operation-scoped lock with the provided owner token', async () => {
      redisMock.eval.mockResolvedValue(1);

      await expect(stateManager.tryClaimStep('op-lock', 3, 120, 'owner-1')).resolves.toBe(true);

      const [script, keyCount, key, owner, ttl] = redisMock.eval.mock.calls[0];
      expect(script).toContain("'NX'");
      expect(keyCount).toBe(1);
      expect(key).toBe('agent_runtime_operation_lock:op-lock');
      expect(owner).toBe('owner-1');
      expect(ttl).toBe('120');
    });

    it('re-enters a lock the same owner already holds', async () => {
      // The inline step loop runs several steps under one lock. Re-entry keeps
      // the lock unbroken across step boundaries; owner tokens carry a random
      // UUID, so only the invocation that took the lock can present its token.
      redisMock.eval.mockResolvedValue(1);

      await expect(stateManager.tryClaimStep('op-lock', 4, 120, 'owner-1')).resolves.toBe(true);

      const script = redisMock.eval.mock.calls[0][0] as string;
      expect(script).toContain("redis.call('get', KEYS[1]) == ARGV[1]");
      expect(script).toContain("redis.call('expire', KEYS[1], ARGV[2])");
    });

    it('refuses a lock held by a different owner', async () => {
      redisMock.eval.mockResolvedValue(0);

      await expect(stateManager.tryClaimStep('op-lock', 5, 120, 'owner-2')).resolves.toBe(false);
    });

    it('refreshes only the lock owned by the caller', async () => {
      redisMock.eval.mockResolvedValue(1);

      await expect(stateManager.refreshStepLock('op-lock', 4, 120, 'owner-1')).resolves.toBe(true);

      expect(redisMock.eval).toHaveBeenCalledWith(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('expire', KEYS[1], ARGV[2]) else return 0 end",
        1,
        'agent_runtime_operation_lock:op-lock',
        'owner-1',
        '120',
      );
    });

    it('releases only the lock owned by the caller', async () => {
      redisMock.eval.mockResolvedValue(1);

      await stateManager.releaseStepLock('op-lock', 5, 'owner-1');

      expect(redisMock.eval).toHaveBeenCalledWith(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        'agent_runtime_operation_lock:op-lock',
        'owner-1',
      );
    });
  });

  describe('interrupt sentinel', () => {
    it('markInterrupted writes a small sentinel key with the state TTL', async () => {
      await stateManager.markInterrupted('op-int');

      expect(redisMock.setex).toHaveBeenCalledWith('agent_runtime_interrupt:op-int', 2 * 3600, '1');
    });

    it('isInterrupted checks key existence instead of loading the state blob', async () => {
      redisMock.exists.mockResolvedValueOnce(1);
      expect(await stateManager.isInterrupted('op-int')).toBe(true);

      redisMock.exists.mockResolvedValueOnce(0);
      expect(await stateManager.isInterrupted('op-int')).toBe(false);

      expect(redisMock.exists).toHaveBeenCalledWith('agent_runtime_interrupt:op-int');
      expect(redisMock.get).not.toHaveBeenCalled();
    });

    it('deleteAgentOperation removes the sentinel with the other keys', async () => {
      await stateManager.deleteAgentOperation('op-del');

      expect(redisMock.del).toHaveBeenCalledWith(
        'agent_runtime_state:op-del',
        'agent_runtime_toolset:op-del',
        'agent_runtime_steps:op-del',
        'agent_runtime_meta:op-del',
        'agent_runtime_interrupt:op-del',
        'agent_runtime_queued_messages:op-del',
        'agent_runtime_inline_resume:op-del',
      );
    });
  });

  describe('queued messages flag', () => {
    it('setQueuedMessages(true) writes a small key with the state TTL', async () => {
      await stateManager.setQueuedMessages('op-q', true);

      expect(redisMock.setex).toHaveBeenCalledWith(
        'agent_runtime_queued_messages:op-q',
        2 * 3600,
        '1',
      );
    });

    it('setQueuedMessages(false) deletes the key', async () => {
      await stateManager.setQueuedMessages('op-q', false);

      expect(redisMock.del).toHaveBeenCalledWith('agent_runtime_queued_messages:op-q');
      expect(redisMock.setex).not.toHaveBeenCalled();
    });

    it('hasQueuedMessages checks key existence instead of loading the state blob', async () => {
      redisMock.exists.mockResolvedValueOnce(1);
      expect(await stateManager.hasQueuedMessages('op-q')).toBe(true);

      redisMock.exists.mockResolvedValueOnce(0);
      expect(await stateManager.hasQueuedMessages('op-q')).toBe(false);

      expect(redisMock.exists).toHaveBeenCalledWith('agent_runtime_queued_messages:op-q');
      expect(redisMock.get).not.toHaveBeenCalled();
    });
  });

  describe('inline resume envelope', () => {
    it('parks the envelope under the operation TTL', async () => {
      await expect(stateManager.saveInlineResume('op-resume', '{"stepIndex":4}')).resolves.toBe(
        true,
      );

      expect(redisMock.setex).toHaveBeenCalledWith(
        'agent_runtime_inline_resume:op-resume',
        2 * 3600,
        '{"stepIndex":4}',
      );
    });

    it('reads the envelope', async () => {
      redisMock.get.mockResolvedValue('{"stepIndex":4}');
      await expect(stateManager.loadInlineResume('op-resume')).resolves.toBe('{"stepIndex":4}');
    });

    it('clears the envelope only for the current lock owner', async () => {
      // An unconditional DEL lets a worker that lost the lock race delete the
      // newer envelope a live worker just parked, stranding it if it then dies.
      redisMock.eval.mockResolvedValue(1);

      await stateManager.clearInlineResume('op-resume', 'owner-1');

      const [script, keyCount, lockKey, resumeKey, owner] = redisMock.eval.mock.calls[0];
      expect(script).toContain("redis.call('get', KEYS[1]) == ARGV[1]");
      expect(script).toContain("redis.call('del', KEYS[2])");
      expect(keyCount).toBe(2);
      expect(lockKey).toBe('agent_runtime_operation_lock:op-resume');
      expect(resumeKey).toBe('agent_runtime_inline_resume:op-resume');
      expect(owner).toBe('owner-1');
    });

    it('reports a failed park so the caller can fall back to the queue', async () => {
      // Silently swallowing this would inline the next step with no envelope and
      // no queue message behind it — the exact stranding the envelope prevents.
      redisMock.setex.mockRejectedValueOnce(new Error('redis down'));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(function () {});

      await expect(stateManager.saveInlineResume('op-resume', '{"stepIndex":4}')).resolves.toBe(
        false,
      );
      errorSpy.mockRestore();
    });

    it('surfaces a read failure instead of reporting no envelope', async () => {
      // "No envelope" means run the delivered step; "could not read the
      // envelope" may mean an operation is mid-loop with nothing queued behind
      // it. Collapsing the two would ACK that delivery as stale and strand it.
      redisMock.get.mockRejectedValue(new Error('redis down'));

      await expect(stateManager.loadInlineResume('op-resume')).rejects.toThrow('redis down');
    });
  });
});
