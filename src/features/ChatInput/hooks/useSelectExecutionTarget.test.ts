import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSelectExecutionTarget } from './useSelectExecutionTarget';

const testState = vi.hoisted(() => ({
  chatInput: { topicModelContext: undefined as { topicId?: string | null } | undefined },
  electron: { gatewayDeviceInfo: undefined as { deviceId?: string } | undefined },
  getDeviceInfo: vi.fn(),
  isDesktop: false,
  effective: {
    agencyConfig: undefined as
      { boundDeviceId?: string; executionTarget?: string; workingDirByDevice?: object } | undefined,
    hasTopicPreference: false,
  },
  user: {
    updateExecutionTargetPreference: vi.fn(),
  },
}));

vi.mock('@lobechat/const', () => ({
  get isDesktop() {
    return testState.isDesktop;
  },
}));

vi.mock('@/features/ChatInput/store', () => ({
  useChatInputStore: (selector: (s: typeof testState.chatInput) => unknown) =>
    selector(testState.chatInput),
}));

vi.mock('@/hooks/useEffectiveAgentConfig', () => ({
  useEffectiveAgentConfig: () => ({
    config: { agencyConfig: testState.effective.agencyConfig },
    executionTargetError: undefined,
    hasSourcePreference: false,
    hasTopicPreference: testState.effective.hasTopicPreference,
    isExecutionTargetLoading: false,
    retryExecutionTarget: vi.fn(),
  }),
}));

vi.mock('@/services/electron/gatewayConnection', () => ({
  gatewayConnectionService: { getDeviceInfo: () => testState.getDeviceInfo() },
}));

vi.mock('@/store/electron', () => ({
  useElectronStore: (selector: (s: typeof testState.electron) => unknown) =>
    selector(testState.electron),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (s: typeof testState.user) => unknown) => selector(testState.user),
}));

describe('useSelectExecutionTarget', () => {
  beforeEach(() => {
    testState.chatInput.topicModelContext = undefined;
    testState.electron.gatewayDeviceInfo = undefined;
    testState.getDeviceInfo = vi.fn();
    testState.isDesktop = false;
    testState.user.updateExecutionTargetPreference = vi.fn().mockResolvedValue(undefined);
    testState.effective.agencyConfig = undefined;
    testState.effective.hasTopicPreference = false;
  });

  it('stores a no-topic selection as the source-client Agent default', async () => {
    const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

    await act(() => result.current.selectExecutionTarget('sandbox'));

    expect(testState.user.updateExecutionTargetPreference).toHaveBeenCalledWith({
      agentId: 'agent-id',
      selection: { executionTarget: 'sandbox' },
    });
  });

  it('stores an existing-topic selection in Topic scope', async () => {
    testState.chatInput.topicModelContext = { topicId: 'topic-id' };
    const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

    await act(() => result.current.selectExecutionTarget('device', 'device-id'));

    expect(testState.user.updateExecutionTargetPreference).toHaveBeenCalledWith({
      agentId: 'agent-id',
      selection: { boundDeviceId: 'device-id', executionTarget: 'device' },
      topicId: 'topic-id',
    });
  });

  it('resolves and stores this desktop for local execution', async () => {
    testState.isDesktop = true;
    testState.electron.gatewayDeviceInfo = { deviceId: 'this-device' };
    const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

    await act(() => result.current.selectExecutionTarget('local'));

    expect(testState.user.updateExecutionTargetPreference).toHaveBeenCalledWith({
      agentId: 'agent-id',
      selection: { boundDeviceId: 'this-device', executionTarget: 'local' },
    });
  });

  it('deletes the Topic preference when following the Agent default', async () => {
    testState.chatInput.topicModelContext = { topicId: 'topic-id' };
    const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

    await act(() => result.current.followAgentDefault());

    expect(testState.user.updateExecutionTargetPreference).toHaveBeenCalledWith({
      agentId: 'agent-id',
      selection: null,
      topicId: 'topic-id',
    });
  });

  it('applies Topic preference over Agent and shared configuration', () => {
    testState.chatInput.topicModelContext = { topicId: 'topic-id' };
    testState.effective.agencyConfig = {
      boundDeviceId: 'topic-device',
      executionTarget: 'device',
    };
    testState.effective.hasTopicPreference = true;

    const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

    expect(result.current.agencyConfig).toMatchObject({
      boundDeviceId: 'topic-device',
      executionTarget: 'device',
    });
  });
});
