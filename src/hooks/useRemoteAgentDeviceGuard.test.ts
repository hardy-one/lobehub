import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceService } from '@/services/device';

import { useRemoteAgentDeviceGuard } from './useRemoteAgentDeviceGuard';

vi.mock('@/services/device', () => ({
  deviceService: { checkCapability: vi.fn(), listDevices: vi.fn() },
}));

const mockedListDevices = vi.mocked(deviceService.listDevices);

describe('useRemoteAgentDeviceGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('checks the EFFECTIVE bound device (with the caller override merged)', async () => {
    // The workspace-shared row points at the creator's (offline) machine; the
    // caller's override picks their own online device — the guard must probe
    // the override device, not the shared one (LOBE-11904).
    const agencyConfig = {
      boundDeviceId: 'my-device',
      executionTarget: 'device',
      heterogeneousProvider: { type: 'codex' },
    } as const;
    mockedListDevices.mockResolvedValue([
      { deviceId: 'creator-device', online: false },
      { deviceId: 'my-device', online: true },
    ] as never);

    const { result } = renderHook(() => useRemoteAgentDeviceGuard({ agencyConfig }));

    await waitFor(() => expect(result.current.status).toBe('ok'));
  });

  it('reports device-offline when the effective bound device has no live channel', async () => {
    const agencyConfig = {
      boundDeviceId: 'my-device',
      executionTarget: 'device',
      heterogeneousProvider: { type: 'claude-code' },
    } as const;
    mockedListDevices.mockResolvedValue([{ deviceId: 'my-device', online: false }] as never);

    const { result } = renderHook(() => useRemoteAgentDeviceGuard({ agencyConfig }));

    await waitFor(() => expect(result.current.status).toBe('device-offline'));
  });

  it('stays in checking (and does not probe) while the workspace preference loads', async () => {
    const agencyConfig = {
      boundDeviceId: 'creator-device',
      executionTarget: 'device',
      heterogeneousProvider: { type: 'codex' },
    } as const;

    const { result } = renderHook(() =>
      useRemoteAgentDeviceGuard({ agencyConfig, isLoading: true }),
    );

    await waitFor(() => expect(result.current.status).toBe('checking'));
    expect(mockedListDevices).not.toHaveBeenCalled();
  });

  it('reports no-device when nothing is bound', async () => {
    const agencyConfig = { heterogeneousProvider: { type: 'codex' } } as const;

    const { result } = renderHook(() => useRemoteAgentDeviceGuard({ agencyConfig }));

    await waitFor(() => expect(result.current.status).toBe('no-device'));
  });
});
