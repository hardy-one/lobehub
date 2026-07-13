import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatInputTopicModel, useTopicModel } from './useTopicModel';

const testState = vi.hoisted(() => ({
  agent: {
    activeAgentId: 'active-agent',
    model: 'agent-model',
    provider: 'agent-provider',
    updateAgentConfigById: vi.fn(),
  },
  chatInput: {
    agentId: undefined as string | undefined,
    topicModelContext: undefined as
      { groupId?: string; scope?: 'group' | 'main'; topicId?: string | null } | undefined,
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
    updateTopicMetadata: vi.fn(),
    useFetchTopicModelOverride: vi.fn(() => ({ data: undefined })),
  },
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: typeof testState.agent) => unknown) =>
    selector(testState.agent),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgentModelById: () => (state: typeof testState.agent) => state.model,
    getAgentModelProviderById: () => (state: typeof testState.agent) => state.provider,
  },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: typeof testState.chat) => unknown) => selector(testState.chat),
}));

vi.mock('../store', () => ({
  useChatInputStore: (selector: (state: typeof testState.chatInput) => unknown) =>
    selector(testState.chatInput),
}));

describe('useTopicModel', () => {
  beforeEach(() => {
    testState.agent.activeAgentId = 'active-agent';
    testState.agent.model = 'agent-model';
    testState.agent.provider = 'agent-provider';
    testState.agent.updateAgentConfigById = vi.fn();
    testState.chatInput.agentId = undefined;
    testState.chatInput.topicModelContext = undefined;
    testState.chat.topicDataMap = {};
    testState.chat.topicModelOverrideMap = {};
    testState.chat.updateTopicMetadata = vi.fn();
    testState.chat.useFetchTopicModelOverride = vi.fn(() => ({ data: undefined }));
  });

  it('falls back to the active Agent when ChatInput has no explicit agentId', async () => {
    const { result } = renderHook(() => useChatInputTopicModel());

    await result.current.setModel({ model: 'next-model', provider: 'next-provider' });

    expect(testState.agent.updateAgentConfigById).toHaveBeenCalledWith('active-agent', {
      model: 'next-model',
      provider: 'next-provider',
    });
  });

  it.each([
    [
      'Agent',
      { agentId: 'agent-1', scope: 'main' as const, topicId: 'topic-1' },
      'agent_agent-1',
      { agentId: 'agent-1', groupId: undefined, scope: 'agent' },
    ],
    [
      'Group supervisor',
      {
        agentId: 'supervisor-1',
        groupId: 'group-1',
        scope: 'group' as const,
        topicId: 'topic-1',
      },
      'group_group-1',
      { agentId: undefined, groupId: 'group-1', scope: 'group' },
    ],
  ])('reads and updates a %s Topic override', async (_, context, topicKey, expectedScope) => {
    testState.chat.topicDataMap = {
      [topicKey]: {
        items: [
          {
            id: 'topic-1',
            metadata: { modelOverride: { model: 'topic-model', provider: 'topic-provider' } },
          },
        ],
      },
    };
    const { result } = renderHook(() => useTopicModel(context));

    expect(result.current.model).toBe('topic-model');
    await result.current.setModel({ model: 'next-model', provider: 'next-provider' });

    expect(testState.chat.updateTopicMetadata).toHaveBeenCalledWith(
      'topic-1',
      { modelOverride: { model: 'next-model', provider: 'next-provider' } },
      expectedScope,
    );
  });

  it('restores an override for a Topic outside the paginated list', () => {
    testState.chat.topicModelOverrideMap = {
      'topic-1': { model: 'topic-model', provider: 'topic-provider' },
    };

    const { result } = renderHook(() =>
      useTopicModel({ agentId: 'agent-1', scope: 'main', topicId: 'topic-1' }),
    );

    expect(result.current.model).toBe('topic-model');
    expect(result.current.provider).toBe('topic-provider');
    expect(testState.chat.useFetchTopicModelOverride).toHaveBeenCalledWith('topic-1');
  });
});
