import { isRemoteHeterogeneousType } from '@lobechat/heterogeneous-agents';
import type { LobeAgentAgencyConfig } from '@lobechat/types';
import { useCallback, useEffect, useState } from 'react';

import { deviceService } from '@/services/device';

export type RemoteAgentDeviceStatus =
  'checking' | 'device-offline' | 'no-device' | 'ok' | 'platform-unavailable';

interface UseRemoteAgentDeviceGuardOptions {
  agencyConfig?: LobeAgentAgencyConfig;
  enabled?: boolean;
  isLoading?: boolean;
}

interface UseRemoteAgentDeviceGuardResult {
  refresh: () => void;
  status: RemoteAgentDeviceStatus;
}

/**
 * Checks whether the bound device is online and, for remote-only hetero
 * platforms, whether that platform is available on the device. Used in
 * HeterogeneousChatInput before device-dispatched hetero runs.
 */
export const useRemoteAgentDeviceGuard = ({
  agencyConfig,
  enabled = true,
  isLoading = false,
}: UseRemoteAgentDeviceGuardOptions): UseRemoteAgentDeviceGuardResult => {
  const boundDeviceId = agencyConfig?.boundDeviceId;
  const providerType = agencyConfig?.heterogeneousProvider?.type;

  const [status, setStatus] = useState<RemoteAgentDeviceStatus>('checking');

  const check = useCallback(async () => {
    if (!enabled) return;
    if (isLoading) {
      setStatus('checking');
      return;
    }

    if (!boundDeviceId) {
      setStatus('no-device');
      return;
    }

    setStatus('checking');

    try {
      const devices = await deviceService.listDevices();
      const device = devices.find((d) => d.deviceId === boundDeviceId);

      if (!device || !device.online) {
        setStatus('device-offline');
        return;
      }

      if (providerType && isRemoteHeterogeneousType(providerType)) {
        const capability = await deviceService.checkCapability({
          deviceId: boundDeviceId,
          platform: providerType,
        });
        setStatus(capability.available ? 'ok' : 'platform-unavailable');
      } else {
        setStatus('ok');
      }
    } catch {
      // On error, allow sending — don't block user on network issues
      setStatus('ok');
    }
  }, [boundDeviceId, enabled, isLoading, providerType]);

  useEffect(() => {
    void check();
  }, [check]);

  // Re-check when window regains focus
  useEffect(() => {
    if (!enabled) return;
    const handler = () => void check();
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [enabled, check]);

  return { refresh: () => void check(), status };
};
