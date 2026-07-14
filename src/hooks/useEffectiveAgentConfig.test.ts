import type { LobeAgentConfig } from '@lobechat/types';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveEffectiveAgentConfig, useEffectiveAgentConfig } from './useEffectiveAgentConfig';

const baseConfig = {
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
    agentMap: {} as Record<string, LobeAgentConfig>,
    agentNotFoundMap: {} as Record<string, boolean>,
  },
  chat: {
    topicDataMap: {} as Record<
      string,
      {
        items: Array<{
          id: string;
          metadata?: { modelOverride?: { model: string; provider: string } };
        }>;
      }
    >,
    topicModelOverrideMap: {} as Record<string, { model: string; provider: string } | null>,
    useFetchTopicModelOverride: vi.fn(() => ({
      data: undefined,
      error: undefined,
      mutate: vi.fn(),
    })),
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
  },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: typeof testState.chat) => unknown) => selector(testState.chat),
}));

describe('resolveEffectiveAgentConfig', () => {
  it('applies the Topic model without changing the original Agent config', () => {
    const result = resolveEffectiveAgentConfig({
      agentConfig: baseConfig,
      topicModelOverride: { model: 'topic-model', provider: 'topic-provider' },
    });

    expect(result).toMatchObject({ model: 'topic-model', provider: 'topic-provider' });
    expect(baseConfig).toMatchObject({ model: 'agent-model', provider: 'agent-provider' });
  });
});

describe('useEffectiveAgentConfig', () => {
  beforeEach(() => {
    testState.agent.agentConfigErrorMap = {};
    testState.agent.agentMap = { 'agent-1': { ...baseConfig } };
    testState.agent.agentNotFoundMap = {};
    testState.chat.topicDataMap = {};
    testState.chat.topicModelOverrideMap = {};
    testState.chat.useFetchTopicModelOverride = vi.fn(() => ({
      data: undefined,
      error: undefined,
      mutate: vi.fn(),
    }));
  });

  it('resolves a Group Topic model override for the supervisor', () => {
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

    const { result } = renderHook(() =>
      useEffectiveAgentConfig({
        agentId: 'agent-1',
        groupId: 'group-1',
        scope: 'group',
        topicId: 'topic-1',
      }),
    );

    expect(result.current.config).toMatchObject({
      model: 'topic-model',
      provider: 'topic-provider',
    });
    expect(testState.chat.useFetchTopicModelOverride).toHaveBeenCalledWith(undefined);
  });

  it('uses the independent Topic cache outside the paginated list', () => {
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
});
