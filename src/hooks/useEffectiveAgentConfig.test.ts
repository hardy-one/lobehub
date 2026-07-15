import type { LobeAgentConfig } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveEffectiveAgentConfig, useEffectiveAgentConfig } from './useEffectiveAgentConfig';

const baseConfig = {
  agencyConfig: {
    boundDeviceId: 'shared-device',
    executionTarget: 'device',
  },
  chatConfig: {},
  model: 'agent-model',
  params: {},
  provider: 'agent-provider',
  systemRole: '',
  tts: {},
} as LobeAgentConfig;

const testState = vi.hoisted(() => ({
  agent: {
    agentConfigErrorMap: {} as Record<string, string>,
    agentMap: {} as Record<string, LobeAgentConfig & { workspaceId?: string }>,
    agentNotFoundMap: {} as Record<string, boolean>,
    retryAgentConfigFetch: vi.fn(),
  },
  chat: {
    topicDataMap: {} as Record<
      string,
      {
        items: Array<{
          id: string;
          metadata?: {
            modelOverride?: { model: string; provider: string };
          };
        }>;
      }
    >,
    topicModelOverrideMap: {} as Record<string, { model: string; provider: string } | null>,
    useFetchTopicModelOverride: vi.fn(() => ({
      data: undefined,
      error: undefined as Error | undefined,
      isLoading: false,
      mutate: vi.fn(),
    })),
  },
  user: {
    executionTargetPreferenceMap: {} as Record<string, unknown>,
    useFetchExecutionTargetPreference: vi.fn(() => ({
      data: undefined as { agent: null; topic: null } | undefined,
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    })),
    useFetchWorkspaceUserPreference: vi.fn(() => ({
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    })),
    workspaceUserPreference: {} as {
      agentDeviceOverrides?: Record<string, { boundDeviceId?: string; executionTarget?: string }>;
    },
  },
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: typeof testState.agent) => unknown) =>
    selector(testState.agent),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgentConfigErrorById: (id: string) => (state: typeof testState.agent) =>
      state.agentConfigErrorMap[id],
    isAgentConfigLoadingById: (id: string) => (state: typeof testState.agent) =>
      !state.agentMap[id] && !state.agentNotFoundMap[id],
    isWorkspaceAgentById: (id: string) => (state: typeof testState.agent) =>
      !!state.agentMap[id]?.workspaceId,
  },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: typeof testState.chat) => unknown) => selector(testState.chat),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: typeof testState.user) => unknown) => selector(testState.user),
}));

vi.mock('@/store/user/selectors', () => ({
  workspaceUserSettingsSelectors: {
    agentDeviceOverrideById: (id: string) => (state: typeof testState.user) =>
      state.workspaceUserPreference.agentDeviceOverrides?.[id],
  },
}));

describe('resolveEffectiveAgentConfig', () => {
  it('applies Topic model and Topic device preference without changing the original Agent config', () => {
    const result = resolveEffectiveAgentConfig({
      agentConfig: baseConfig,
      agentPreference: { executionTarget: 'sandbox' },
      topicModelOverride: { model: 'topic-model', provider: 'topic-provider' },
      topicPreference: { boundDeviceId: 'topic-device', executionTarget: 'device' },
      workspaceOverride: { boundDeviceId: 'workspace-device', executionTarget: 'device' },
    });

    expect(result).toMatchObject({
      agencyConfig: {
        boundDeviceId: 'topic-device',
        executionTarget: 'device',
      },
      model: 'topic-model',
      provider: 'topic-provider',
    });
    expect(baseConfig).toMatchObject({
      agencyConfig: { boundDeviceId: 'shared-device', executionTarget: 'device' },
      model: 'agent-model',
      provider: 'agent-provider',
    });
  });

  it('does not apply a Topic model to a heterogeneous Agent', () => {
    const result = resolveEffectiveAgentConfig({
      agentConfig: {
        ...baseConfig,
        agencyConfig: {
          ...baseConfig.agencyConfig,
          heterogeneousProvider: { type: 'claude-code' },
        },
      },
      topicModelOverride: { model: 'topic-model', provider: 'topic-provider' },
    });

    expect(result).toMatchObject({
      model: 'agent-model',
      provider: 'agent-provider',
    });
  });
});

describe('useEffectiveAgentConfig', () => {
  beforeEach(() => {
    testState.agent.agentConfigErrorMap = {};
    testState.agent.agentMap = { 'agent-1': { ...baseConfig } };
    testState.agent.agentNotFoundMap = {};
    testState.agent.retryAgentConfigFetch = vi.fn();
    testState.chat.topicDataMap = {};
    testState.chat.topicModelOverrideMap = {};
    testState.chat.useFetchTopicModelOverride = vi.fn(() => ({
      data: undefined,
      error: undefined as Error | undefined,
      isLoading: false,
      mutate: vi.fn(),
    }));
    testState.user.executionTargetPreferenceMap = {};
    testState.user.useFetchExecutionTargetPreference = vi.fn(() => ({
      data: { agent: null, topic: null },
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    }));
    testState.user.useFetchWorkspaceUserPreference = vi.fn(() => ({
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    }));
    testState.user.workspaceUserPreference = {};
  });

  it('resolves Group Topic model and source-specific Topic device preference', () => {
    testState.agent.agentMap['agent-1'] = { ...baseConfig, workspaceId: 'workspace-1' };
    testState.chat.topicDataMap = {
      'group_group-1': {
        items: [
          {
            id: 'topic-1',
            metadata: {
              modelOverride: { model: 'topic-model', provider: 'topic-provider' },
            },
          },
        ],
      },
    };
    testState.user.executionTargetPreferenceMap = {
      'agent:agent-1': { executionTarget: 'sandbox' },
      'topic:topic-1': { boundDeviceId: 'topic-device', executionTarget: 'device' },
    };

    const { result } = renderHook(() =>
      useEffectiveAgentConfig({
        agentId: 'agent-1',
        groupId: 'group-1',
        scope: 'group',
        topicId: 'topic-1',
      }),
    );

    expect(result.current.config).toMatchObject({
      agencyConfig: { boundDeviceId: 'topic-device', executionTarget: 'device' },
      model: 'topic-model',
      provider: 'topic-provider',
    });
    expect(result.current.workspaceScoped).toBe(false);
    expect(testState.chat.useFetchTopicModelOverride).toHaveBeenCalledWith(undefined);
  });

  it('uses the independent Topic cache when the Topic is outside the paginated list', () => {
    testState.chat.topicModelOverrideMap = {
      'topic-1': { model: 'cached-model', provider: 'cached-provider' },
    };

    const { result } = renderHook(() =>
      useEffectiveAgentConfig({ agentId: 'agent-1', topicId: 'topic-1' }),
    );

    expect(result.current.config).toMatchObject({
      model: 'cached-model',
      provider: 'cached-provider',
    });
    expect(result.current.isLoading).toBe(false);
    expect(testState.chat.useFetchTopicModelOverride).toHaveBeenCalledWith('topic-1');
  });

  it('marks an unresolved Topic model as unavailable after its fetch fails', () => {
    const topicModelError = new Error('topic model unavailable');
    testState.chat.useFetchTopicModelOverride = vi.fn(() => ({
      data: undefined,
      error: topicModelError,
      isLoading: false,
      mutate: vi.fn(),
    }));

    const { result } = renderHook(() =>
      useEffectiveAgentConfig({ agentId: 'agent-1', topicId: 'topic-1' }),
    );

    expect(result.current.config).toMatchObject({
      model: 'agent-model',
      provider: 'agent-provider',
    });
    expect(result.current.isModelLoading).toBe(false);
    expect(result.current.isModelUnavailable).toBe(true);
    expect(result.current.topicModelError).toBe(topicModelError);
  });

  it('does not fetch or gate a heterogeneous Agent on a Topic model', () => {
    const topicModelError = new Error('topic model unavailable');
    testState.agent.agentMap['agent-1'] = {
      ...baseConfig,
      agencyConfig: {
        ...baseConfig.agencyConfig,
        heterogeneousProvider: { type: 'claude-code' },
      },
    };
    testState.chat.useFetchTopicModelOverride = vi.fn(() => ({
      data: undefined,
      error: topicModelError,
      isLoading: false,
      mutate: vi.fn(),
    }));

    const { result } = renderHook(() =>
      useEffectiveAgentConfig({ agentId: 'agent-1', topicId: 'topic-1' }),
    );

    expect(result.current.config).toMatchObject({
      model: 'agent-model',
      provider: 'agent-provider',
    });
    expect(result.current.isModelLoading).toBe(false);
    expect(result.current.isModelUnavailable).toBe(false);
    expect(result.current.modelError).toBeUndefined();
    expect(result.current.topicModelError).toBeUndefined();
    expect(testState.chat.useFetchTopicModelOverride).toHaveBeenCalledWith(undefined);
  });

  it('retries a missing Agent config through both model and execution-target recovery', async () => {
    testState.agent.agentMap = {};
    testState.agent.agentConfigErrorMap = { 'agent-1': 'agent config unavailable' };

    const { result } = renderHook(() => useEffectiveAgentConfig({ agentId: 'agent-1' }));

    expect(result.current.isModelUnavailable).toBe(true);
    expect(result.current.executionTargetError).toBe('agent config unavailable');

    await act(() => result.current.retryModel());
    await act(() => result.current.retryExecutionTarget());

    expect(testState.agent.retryAgentConfigFetch).toHaveBeenNthCalledWith(1, 'agent-1');
    expect(testState.agent.retryAgentConfigFetch).toHaveBeenNthCalledWith(2, 'agent-1');
  });

  it('keeps using cached Agent config when a background revalidation fails', () => {
    testState.agent.agentConfigErrorMap = { 'agent-1': 'background refresh failed' };

    const { result } = renderHook(() => useEffectiveAgentConfig({ agentId: 'agent-1' }));

    expect(result.current.config).toEqual(baseConfig);
    expect(result.current.modelError).toBeUndefined();
    expect(result.current.executionTargetError).toBeUndefined();
    expect(result.current.isModelUnavailable).toBe(false);
  });

  it('marks workspace user device overrides as private preferences', () => {
    testState.agent.agentMap['agent-1'] = { ...baseConfig, workspaceId: 'workspace-1' };
    testState.user.workspaceUserPreference = {
      agentDeviceOverrides: {
        'agent-1': { boundDeviceId: 'private-device', executionTarget: 'device' },
      },
    };

    const { result } = renderHook(() => useEffectiveAgentConfig({ agentId: 'agent-1' }));

    expect(result.current.hasWorkspaceOverride).toBe(true);
    expect(result.current.config?.agencyConfig).toMatchObject({
      boundDeviceId: 'private-device',
      executionTarget: 'device',
    });
  });
});
