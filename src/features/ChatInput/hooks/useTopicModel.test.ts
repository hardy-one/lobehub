import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatInputTopicModel, useTopicModel } from './useTopicModel';

const toastError = vi.hoisted(() => vi.fn());

const testState = vi.hoisted(() => ({
  agent: {
    activeAgentId: 'active-agent',
    updateAgentConfigById: vi.fn(),
  },
  chatInput: {
    agentId: undefined as string | undefined,
    topicModelContext: undefined as
      { groupId?: string; scope?: 'group' | 'main'; topicId?: string | null } | undefined,
  },
  chat: {
    updateTopicMetadata: vi.fn(),
  },
  effective: {
    config: { model: 'agent-model', provider: 'agent-provider' },
    lastContext: undefined as unknown,
  },
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  toast: { error: toastError },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/hooks/useEffectiveAgentConfig', () => ({
  useEffectiveAgentConfig: (context: unknown) => {
    testState.effective.lastContext = context;
    return {
      config: testState.effective.config,
      isModelLoading: false,
      modelError: undefined,
      retryModel: vi.fn(),
    };
  },
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: typeof testState.agent) => unknown) =>
    selector(testState.agent),
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
    testState.agent.updateAgentConfigById = vi.fn();
    testState.chatInput.agentId = undefined;
    testState.chatInput.topicModelContext = undefined;
    testState.chat.updateTopicMetadata = vi.fn();
    testState.effective.config = { model: 'agent-model', provider: 'agent-provider' };
    testState.effective.lastContext = undefined;
    toastError.mockReset();
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
      { agentId: undefined, groupId: 'group-1', scope: 'group' },
    ],
  ])('reads and updates a %s Topic override', async (_, context, expectedScope) => {
    testState.effective.config = { model: 'topic-model', provider: 'topic-provider' };
    const { result } = renderHook(() => useTopicModel(context));

    expect(result.current.model).toBe('topic-model');
    await result.current.setModel({ model: 'next-model', provider: 'next-provider' });

    expect(testState.chat.updateTopicMetadata).toHaveBeenCalledWith(
      'topic-1',
      { modelOverride: { model: 'next-model', provider: 'next-provider' } },
      expectedScope,
    );
  });

  it('uses the effective config resolved for the requested Topic context', () => {
    testState.effective.config = { model: 'topic-model', provider: 'topic-provider' };

    const { result } = renderHook(() =>
      useTopicModel({ agentId: 'agent-1', scope: 'main', topicId: 'topic-1' }),
    );

    expect(result.current.model).toBe('topic-model');
    expect(result.current.provider).toBe('topic-provider');
    expect(testState.effective.lastContext).toEqual({
      agentId: 'agent-1',
      scope: 'main',
      topicId: 'topic-1',
    });
  });

  it('surfaces Topic model persistence failures without leaking a rejected promise', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    testState.chat.updateTopicMetadata = vi.fn().mockRejectedValue(new Error('save failed'));
    const { result } = renderHook(() =>
      useTopicModel({ agentId: 'agent-1', scope: 'main', topicId: 'topic-1' }),
    );

    await expect(
      result.current.setModel({ model: 'next-model', provider: 'next-provider' }),
    ).resolves.toBeUndefined();

    expect(toastError).toHaveBeenCalledWith('topicModel.saveFailed');
    consoleError.mockRestore();
  });
});
