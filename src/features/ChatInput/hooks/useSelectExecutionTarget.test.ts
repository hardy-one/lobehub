import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSelectExecutionTarget } from './useSelectExecutionTarget';

const testState = vi.hoisted(() => ({
  agent: {
    agencyConfig: undefined as
      { boundDeviceId?: string; executionTarget?: string; workingDirByDevice?: object } | undefined,
    isWorkspaceAgent: false,
  },
  chatInput: { topicModelContext: undefined as { topicId?: string | null } | undefined },
  electron: { gatewayDeviceInfo: undefined as { deviceId?: string } | undefined },
  getDeviceInfo: vi.fn(),
  isDesktop: false,
  user: {
    executionTargetPreferenceMap: {} as Record<string, any>,
    updateExecutionTargetPreference: vi.fn(),
    useFetchExecutionTargetPreference: vi.fn(() => ({
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    })),
    useFetchWorkspaceUserPreference: vi.fn(() => ({
      error: undefined,
      isLoading: false,
    })),
    workspaceUserPreference: {} as {
      agentDeviceOverrides?: Record<string, { boundDeviceId?: string; executionTarget?: string }>;
    },
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

vi.mock('@/services/electron/gatewayConnection', () => ({
  gatewayConnectionService: { getDeviceInfo: () => testState.getDeviceInfo() },
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (s: typeof testState.agent) => unknown) => selector(testState.agent),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgencyConfigById: () => (s: typeof testState.agent) => s.agencyConfig,
    isWorkspaceAgentById: () => (s: typeof testState.agent) => s.isWorkspaceAgent,
  },
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
    testState.agent.agencyConfig = undefined;
    testState.agent.isWorkspaceAgent = false;
    testState.chatInput.topicModelContext = undefined;
    testState.electron.gatewayDeviceInfo = undefined;
    testState.getDeviceInfo = vi.fn();
    testState.isDesktop = false;
    testState.user.executionTargetPreferenceMap = {};
    testState.user.updateExecutionTargetPreference = vi.fn().mockResolvedValue(undefined);
    testState.user.workspaceUserPreference = {};
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
    testState.agent.agencyConfig = { boundDeviceId: 'shared', executionTarget: 'device' };
    testState.chatInput.topicModelContext = { topicId: 'topic-id' };
    testState.user.executionTargetPreferenceMap = {
      'agent:agent-id': { executionTarget: 'sandbox' },
      'topic:topic-id': { boundDeviceId: 'topic-device', executionTarget: 'device' },
    };

    const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

    expect(result.current.agencyConfig).toMatchObject({
      boundDeviceId: 'topic-device',
      executionTarget: 'device',
    });
  });
});
