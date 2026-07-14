import type { ExecutionTargetSelection } from '@lobechat/types';
import type { SWRResponse } from 'swr';

import { useClientDataSWRWithSync } from '@/libs/swr';
import { aiAgentService } from '@/services/aiAgent';
import type { StoreSetter } from '@/store/types';
import type { UserStore } from '@/store/user';
import { setNamespace } from '@/utils/storeDebug';

import {
  agentExecutionTargetPreferenceKey,
  topicExecutionTargetPreferenceKey,
} from './initialState';

const n = setNamespace('executionTargetPreference');
const FETCH_KEY = 'FETCH_EXECUTION_TARGET_PREFERENCE';

interface PreferenceResult {
  agent: ExecutionTargetSelection | null;
  topic: ExecutionTargetSelection | null;
}

interface PreferenceParams {
  agentId: string;
  topicId?: string;
}

type Setter = StoreSetter<UserStore>;

export const createExecutionTargetPreferenceSlice = (
  set: Setter,
  get: () => UserStore,
  _api?: unknown,
) => new ExecutionTargetPreferenceActionImpl(set, get, _api);

export class ExecutionTargetPreferenceActionImpl {
  readonly #get: () => UserStore;
  readonly #mutationQueues = new Map<string, Promise<void>>();
  readonly #mutationVersions = new Map<string, number>();
  readonly #set: Setter;

  constructor(set: Setter, get: () => UserStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  ensureExecutionTargetPreference = async (params: PreferenceParams): Promise<PreferenceResult> => {
    const map = this.#get().executionTargetPreferenceMap;
    const agent = map[agentExecutionTargetPreferenceKey(params.agentId)];
    const topic = params.topicId ? map[topicExecutionTargetPreferenceKey(params.topicId)] : null;
    return agent !== undefined && (!params.topicId || topic !== undefined)
      ? { agent, topic: topic ?? null }
      : this.internal_fetchExecutionTargetPreference(params);
  };

  internal_fetchExecutionTargetPreference = async (
    params: PreferenceParams,
  ): Promise<PreferenceResult> => {
    const agentKey = agentExecutionTargetPreferenceKey(params.agentId);
    const topicKey = params.topicId ? topicExecutionTargetPreferenceKey(params.topicId) : undefined;
    const mapAtStart = this.#get().executionTargetPreferenceMap;
    const agentAtStart = mapAtStart[agentKey];
    const topicAtStart = topicKey ? mapAtStart[topicKey] : undefined;
    const agentVersion = this.#mutationVersions.get(agentKey);
    const topicVersion = topicKey ? this.#mutationVersions.get(topicKey) : undefined;
    const result = await aiAgentService.getExecutionTargetPreference(params);
    const current = this.#get().executionTargetPreferenceMap;
    const next = { ...current };

    if (
      current[agentKey] === agentAtStart &&
      this.#mutationVersions.get(agentKey) === agentVersion
    ) {
      next[agentKey] = result.agent;
    }
    if (
      topicKey &&
      current[topicKey] === topicAtStart &&
      this.#mutationVersions.get(topicKey) === topicVersion
    ) {
      next[topicKey] = result.topic;
    }
    this.#set({ executionTargetPreferenceMap: next }, false, n('fetch'));

    const settled = this.#get().executionTargetPreferenceMap;
    return {
      agent: settled[agentKey] ?? null,
      topic: topicKey ? (settled[topicKey] ?? null) : null,
    };
  };

  updateExecutionTargetPreference = async (
    params: PreferenceParams & { selection: ExecutionTargetSelection | null },
  ): Promise<void> => {
    const key = params.topicId
      ? topicExecutionTargetPreferenceKey(params.topicId)
      : agentExecutionTargetPreferenceKey(params.agentId);
    const map = this.#get().executionTargetPreferenceMap;
    const previous = map[key];
    const version = (this.#mutationVersions.get(key) ?? 0) + 1;
    this.#mutationVersions.set(key, version);
    this.#set(
      { executionTargetPreferenceMap: { ...map, [key]: params.selection } },
      false,
      n('update/optimistic'),
    );

    const previousQueue = this.#mutationQueues.get(key) ?? Promise.resolve();
    const request = previousQueue
      .catch(() => undefined)
      .then(() => aiAgentService.setExecutionTargetPreference(params));
    const settledQueue = request.then(
      () => undefined,
      () => undefined,
    );
    this.#mutationQueues.set(key, settledQueue);

    try {
      const result = await request;
      if (this.#mutationVersions.get(key) !== version) return;
      const current = this.#get().executionTargetPreferenceMap;
      this.#set(
        {
          executionTargetPreferenceMap: {
            ...current,
            [key]: params.topicId ? result.topic : result.agent,
          },
        },
        false,
        n('update/success'),
      );
    } catch (error) {
      if (this.#mutationVersions.get(key) !== version) return;
      const current = this.#get().executionTargetPreferenceMap;
      if (current[key] === params.selection) {
        const next = { ...current };
        if (previous === undefined) delete next[key];
        else next[key] = previous;
        this.#set({ executionTargetPreferenceMap: next }, false, n('update/rollback'));
      }
      throw error;
    } finally {
      if (this.#mutationQueues.get(key) === settledQueue) this.#mutationQueues.delete(key);
    }
  };

  useFetchExecutionTargetPreference = (params?: PreferenceParams): SWRResponse<PreferenceResult> =>
    useClientDataSWRWithSync(
      params ? [FETCH_KEY, params.agentId, params.topicId ?? null] : null,
      () => this.internal_fetchExecutionTargetPreference(params!),
      {
        onData: (result) => {
          if (!params) return;
          const current = this.#get().executionTargetPreferenceMap;
          const agentKey = agentExecutionTargetPreferenceKey(params.agentId);
          const topicKey = params.topicId
            ? topicExecutionTargetPreferenceKey(params.topicId)
            : undefined;
          this.#set(
            {
              executionTargetPreferenceMap: {
                ...current,
                ...(current[agentKey] === undefined ? { [agentKey]: result.agent } : {}),
                ...(topicKey && current[topicKey] === undefined
                  ? { [topicKey]: result.topic }
                  : {}),
              },
            },
            false,
            n('fetch/cache'),
          );
        },
      },
    );
}

export type ExecutionTargetPreferenceAction = Pick<
  ExecutionTargetPreferenceActionImpl,
  keyof ExecutionTargetPreferenceActionImpl
>;
