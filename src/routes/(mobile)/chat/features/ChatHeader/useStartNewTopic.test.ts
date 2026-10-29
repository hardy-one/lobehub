/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useStartNewTopic } from './useStartNewTopic';

const mocks = vi.hoisted(() => ({
  chatState: {
    activeAgentId: 'agt_1' as string | undefined,
    isNewTopicSendInFlight: false,
    openNewTopicOrSaveTopic: vi.fn(),
  },
  mutate: vi.fn(),
  permission: { allowed: true as boolean },
  push: vi.fn(),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: mocks.permission.allowed, reason: undefined }),
}));

vi.mock('@/hooks/useQueryRoute', () => ({
  useQueryRoute: () => ({ push: mocks.push }),
}));

vi.mock('@/libs/swr', () => ({
  useActionSWR: () => ({ mutate: mocks.mutate }),
}));

vi.mock('@/libs/swr/keys', () => ({
  topicActionKeys: { openNewOrSave: () => ['topicAction:openNewOrSave'] },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector(mocks.chatState),
}));

vi.mock('@/store/chat/selectors', () => ({
  topicSelectors: {
    isNewTopicSendInFlight: (state: { isNewTopicSendInFlight: boolean }) =>
      state.isNewTopicSendInFlight,
  },
}));

describe('useStartNewTopic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.chatState.activeAgentId = 'agt_1';
    mocks.chatState.isNewTopicSendInFlight = false;
    mocks.permission.allowed = true;
  });

  it('drops the current topic and sub-route before opening a new topic', () => {
    const { result } = renderHook(() => useStartNewTopic());

    act(() => result.current.startNewTopic());

    expect(mocks.push).toHaveBeenCalledWith('/agent/agt_1');
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
  });

  it('blocks the entry for workspace viewers who cannot create content', () => {
    mocks.permission.allowed = false;

    const { result } = renderHook(() => useStartNewTopic());

    expect(result.current.disabled).toBe(true);

    act(() => result.current.startNewTopic());

    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('blocks the entry while a new-topic send already owns topic creation', () => {
    mocks.chatState.isNewTopicSendInFlight = true;

    const { result } = renderHook(() => useStartNewTopic());

    expect(result.current.disabled).toBe(true);

    act(() => result.current.startNewTopic());

    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
});
