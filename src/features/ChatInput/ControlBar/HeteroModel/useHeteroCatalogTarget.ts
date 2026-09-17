'use client';

import { isDesktop } from '@/const/version';
import { resolveTargetDeviceId } from '@/helpers/agentWorkingDirectory';
import { resolveExecutionTarget } from '@/helpers/executionTarget';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { useEffectiveWorkingDirectory } from '@/hooks/useEffectiveWorkingDirectory';
import { useDeviceStore } from '@/store/device';
import { useElectronStore } from '@/store/electron';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

/**
 * Which host a heterogeneous host-local call (model catalog, thinking-level
 * probe) must address: the current Desktop over IPC (`rpcDeviceId` undefined) or
 * a bound device through the gateway.
 *
 * Both callers need the identical decision, so it lives here instead of being
 * resolved per component.
 */
export const useHeteroCatalogTarget = (agentId?: string) => {
  const { agencyConfig, isPreferenceLoading, workspaceScoped } = useEffectiveAgencyConfig(agentId);
  const isLogin = useUserStore(authSelectors.isLogin);
  const { isLoading: isDeviceListLoading } = useDeviceStore((s) => s.useFetchDevices)(
    isLogin || isDesktop,
  );
  const cwd = useEffectiveWorkingDirectory(agentId);
  const provider = agencyConfig?.heterogeneousProvider;

  useElectronStore((s) => s.useFetchGatewayDeviceInfo)();
  const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);

  const executionTarget = resolveExecutionTarget(agencyConfig, {
    clientExecutionAvailable: isDesktop,
    isHetero: true,
    workspaceScoped,
  });
  const targetDeviceId = resolveTargetDeviceId(agencyConfig, currentDeviceId, { workspaceScoped });
  const isLocalTarget = isDesktop && executionTarget === 'local';
  const rpcDeviceId = isLocalTarget ? undefined : targetDeviceId;

  return {
    agencyConfig,
    cwd,
    isDeviceListLoading,
    isLocalTarget,
    isPreferenceLoading,
    provider,
    rpcDeviceId,
    targetReady: isLocalTarget || (executionTarget === 'device' && !!rpcDeviceId),
  };
};
