import { isDesktop } from '@lobechat/const';
import { getWorkingDirEffectivePath } from '@lobechat/types';

import {
  resolveAgentWorkingDirectory,
  resolveTargetDeviceId,
} from '@/helpers/agentWorkingDirectory';
import { globalAgentContextManager } from '@/helpers/GlobalAgentContextManager';
import type { EffectiveAgentConfigContext } from '@/hooks/useEffectiveAgentConfig';
import { useEffectiveAgentConfig } from '@/hooks/useEffectiveAgentConfig';
import { useAgentStore } from '@/store/agent';
import { deviceSelectors, useDeviceStore } from '@/store/device';
import { useElectronStore } from '@/store/electron';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

/**
 * The agent's effective working directory under the unified precedence:
 *
 *   topic override > agent's per-device choice > legacy localStorage > device
 *   default > home (desktop only).
 *
 * Combines the agent store (agencyConfig + legacy map), chat store (topic cwd),
 * device store (defaultCwd) and the current machine's deviceId. Use this instead
 * of the old `topicCwd || agentCwd` pattern so local and remote resolve the same
 * way. Returns `undefined` only on web with nothing configured.
 */
export const useEffectiveWorkingDirectory = (
  context: EffectiveAgentConfigContext,
): string | undefined => {
  const { agentId } = context;
  // Self-populate the device store (SWR dedupes by key across all callers).
  // Devices live behind an authed lambda procedure, so only fetch once signed in
  // (desktop always fetches — it relies on the local device's saved cwd).
  const isLogin = useUserStore(authSelectors.isLogin);
  useDeviceStore((s) => s.useFetchDevices)(isLogin || isDesktop);

  const { config, executionTargetError, isExecutionTargetLoading, topicMetadata } =
    useEffectiveAgentConfig(context);
  const agencyConfig = config?.agencyConfig;
  const legacyAgentWorkingDirectory = useAgentStore((s) =>
    agentId ? s.localAgentWorkingDirectoryMap[agentId] : undefined,
  );
  const topicWorkingDirectory = isDesktop
    ? getWorkingDirEffectivePath(
        topicMetadata?.workingDirectoryConfig ?? topicMetadata?.workingDirectory,
      )
    : (topicMetadata?.repos?.[0] ??
      getWorkingDirEffectivePath(
        topicMetadata?.workingDirectoryConfig ?? topicMetadata?.workingDirectory,
      ));
  const topicWorkingDirectoryConfig = topicMetadata?.workingDirectoryConfig;
  const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
  const targetDeviceId = resolveTargetDeviceId(agencyConfig, currentDeviceId);
  const deviceDefaultCwd = useDeviceStore(deviceSelectors.getDeviceDefaultCwd(targetDeviceId));

  // Home is the last-resort default, desktop-only (matches the legacy selector).
  const ctx = isDesktop ? globalAgentContextManager.getContext() : undefined;
  const fallback = ctx?.desktopPath ?? ctx?.homePath;

  if (executionTargetError || isExecutionTargetLoading) return;

  return resolveAgentWorkingDirectory({
    agencyConfig,
    currentDeviceId,
    deviceDefaultCwd,
    fallback,
    legacyAgentWorkingDirectory,
    topicWorkingDirectory,
    topicWorkingDirectoryConfig,
  });
};
