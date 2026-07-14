import { act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { aiAgentService } from '@/services/aiAgent';
import { useUserStore } from '@/store/user';

vi.mock('zustand/traditional');

describe('executionTargetPreference actions', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useUserStore.setState({ executionTargetPreferenceMap: {} });
  });

  it('fetches and caches Agent and Topic preferences together', async () => {
    vi.spyOn(aiAgentService, 'getExecutionTargetPreference').mockResolvedValue({
      agent: { executionTarget: 'sandbox' },
      topic: { boundDeviceId: 'topic-device', executionTarget: 'device' },
    });

    const result = await useUserStore
      .getState()
      .ensureExecutionTargetPreference({ agentId: 'agent-id', topicId: 'topic-id' });

    expect(result).toEqual({
      agent: { executionTarget: 'sandbox' },
      topic: { boundDeviceId: 'topic-device', executionTarget: 'device' },
    });
    expect(useUserStore.getState().executionTargetPreferenceMap).toEqual({
      'agent:agent-id': { executionTarget: 'sandbox' },
      'topic:topic-id': { boundDeviceId: 'topic-device', executionTarget: 'device' },
    });
  });

  it('rolls back the optimistic selection when the latest write fails', async () => {
    useUserStore.setState({
      executionTargetPreferenceMap: { 'agent:agent-id': { executionTarget: 'sandbox' } },
    });
    vi.spyOn(aiAgentService, 'setExecutionTargetPreference').mockRejectedValue(
      new Error('save failed'),
    );

    const update = useUserStore.getState().updateExecutionTargetPreference({
      agentId: 'agent-id',
      selection: { executionTarget: 'none' },
    });

    expect(useUserStore.getState().executionTargetPreferenceMap['agent:agent-id']).toEqual({
      executionTarget: 'none',
    });
    await expect(update).rejects.toThrow('save failed');
    expect(useUserStore.getState().executionTargetPreferenceMap['agent:agent-id']).toEqual({
      executionTarget: 'sandbox',
    });
  });

  it('rolls rapid failed writes back to the last confirmed preference', async () => {
    useUserStore.setState({
      executionTargetPreferenceMap: { 'agent:agent-id': { executionTarget: 'sandbox' } },
    });
    vi.spyOn(aiAgentService, 'setExecutionTargetPreference').mockRejectedValue(
      new Error('save failed'),
    );

    const first = useUserStore.getState().updateExecutionTargetPreference({
      agentId: 'agent-id',
      selection: { executionTarget: 'local' },
    });
    const second = useUserStore.getState().updateExecutionTargetPreference({
      agentId: 'agent-id',
      selection: { executionTarget: 'none' },
    });

    await Promise.allSettled([first, second]);

    expect(useUserStore.getState().executionTargetPreferenceMap['agent:agent-id']).toEqual({
      executionTarget: 'sandbox',
    });
  });

  it('serializes rapid writes so the last user choice also wins on the server', async () => {
    let resolveFirst:
      ((value: { agent: { executionTarget: 'sandbox' }; topic: null }) => void) | undefined;
    const setPreference = vi
      .spyOn(aiAgentService, 'setExecutionTargetPreference')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({ agent: { executionTarget: 'none' }, topic: null });

    const first = useUserStore.getState().updateExecutionTargetPreference({
      agentId: 'agent-id',
      selection: { executionTarget: 'sandbox' },
    });
    const second = useUserStore.getState().updateExecutionTargetPreference({
      agentId: 'agent-id',
      selection: { executionTarget: 'none' },
    });

    await waitFor(() => expect(setPreference).toHaveBeenCalledTimes(1));
    expect(useUserStore.getState().executionTargetPreferenceMap['agent:agent-id']).toEqual({
      executionTarget: 'none',
    });

    await act(async () => {
      resolveFirst?.({ agent: { executionTarget: 'sandbox' }, topic: null });
      await first;
    });
    await waitFor(() => expect(setPreference).toHaveBeenCalledTimes(2));
    await second;

    expect(useUserStore.getState().executionTargetPreferenceMap['agent:agent-id']).toEqual({
      executionTarget: 'none',
    });
  });

  it('does not let a Topic response overwrite a concurrent Agent selection', async () => {
    let resolveAgent:
      ((value: { agent: { executionTarget: 'none' }; topic: null }) => void) | undefined;
    vi.spyOn(aiAgentService, 'setExecutionTargetPreference').mockImplementation((params) => {
      if (!params.topicId) {
        return new Promise((resolve) => {
          resolveAgent = resolve;
        });
      }

      return Promise.resolve({
        agent: { executionTarget: 'sandbox' },
        topic: { boundDeviceId: 'topic-device', executionTarget: 'device' },
      });
    });

    const agentUpdate = useUserStore.getState().updateExecutionTargetPreference({
      agentId: 'agent-id',
      selection: { executionTarget: 'none' },
    });
    const topicUpdate = useUserStore.getState().updateExecutionTargetPreference({
      agentId: 'agent-id',
      selection: { boundDeviceId: 'topic-device', executionTarget: 'device' },
      topicId: 'topic-id',
    });

    await topicUpdate;
    expect(useUserStore.getState().executionTargetPreferenceMap['agent:agent-id']).toEqual({
      executionTarget: 'none',
    });

    resolveAgent?.({ agent: { executionTarget: 'none' }, topic: null });
    await agentUpdate;
    expect(useUserStore.getState().executionTargetPreferenceMap).toMatchObject({
      'agent:agent-id': { executionTarget: 'none' },
      'topic:topic-id': { boundDeviceId: 'topic-device', executionTarget: 'device' },
    });
  });
});
