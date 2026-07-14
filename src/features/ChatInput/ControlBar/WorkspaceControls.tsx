'use client';

import { isDesktop } from '@lobechat/const';
import { memo } from 'react';

import { canPersistSharedAgentWorkingDirectory } from '@/helpers/agentWorkingDirectory';
import { executionTargetToRuntimeMode, resolveExecutionTarget } from '@/helpers/executionTarget';
import { useIsGatewayModeEnabled } from '@/helpers/gatewayMode';

import { useChatInputEffectiveAgentConfig } from '../hooks/useEffectiveAgentConfig';
import CloudRepoSwitcher from './CloudRepoSwitcher';
import HeteroDeviceSwitcher from './HeteroDeviceSwitcher';
import WorkingDirectorySection from './WorkingDirectorySection';

interface WorkspaceControlsProps {
  agentId: string;
  /**
   * Force the workspace (directory + branch + file changes + PR) to show even
   * when the runtime isn't in local mode. Heterogeneous agents always run inside
   * a working directory, so they pass `true`; normal agents only surface it in
   * local mode.
   */
  alwaysShowWorkspace?: boolean;
}

/**
 * Workspace/Project control strip shared by the chat-input control bars:
 * device selector + working directory + git branch / file changes / PR info.
 *
 * Both ControlBar (normal agents) and HeteroControlBar (heterogeneous agents)
 * compose this, so the Device / Branch / diff / PR cluster can't drift between
 * them. The bar-specific bits (ModeSelector, ApprovalMode, ContextWindow, the
 * full-access badge) stay in their respective bars.
 */
const WorkspaceControls = memo<WorkspaceControlsProps>(
  ({ agentId, alwaysShowWorkspace = false }) => {
    const {
      config,
      context,
      executionTargetError,
      hasSourcePreference,
      hasWorkspaceOverride,
      isExecutionTargetLoading,
      isWorkspaceAgent,
      workspaceScoped,
    } = useChatInputEffectiveAgentConfig();
    const agencyConfig = config?.agencyConfig;
    const isHeterogeneous = !!agencyConfig?.heterogeneousProvider;
    const deviceRoutingAvailable = useIsGatewayModeEnabled(agentId);
    const effectiveTarget = resolveExecutionTarget(agencyConfig, {
      clientExecutionAvailable: isDesktop,
      deviceRoutingAvailable,
      isHetero: isHeterogeneous,
      workspaceScoped,
    });
    const runtimeMode = executionTargetToRuntimeMode(effectiveTarget);
    const isDeviceMode = effectiveTarget === 'device' && !!agencyConfig?.boundDeviceId;
    const canPersistWorkingDirectory =
      !!context.topicId ||
      canPersistSharedAgentWorkingDirectory({
        hasPrivatePreference: hasSourcePreference || hasWorkspaceOverride,
        isWorkspaceAgent,
      });

    const renderWorkspace = () => {
      if (executionTargetError || isExecutionTargetLoading) return null;

      // Remote device runs get the device-scoped picker, regardless of runtimeMode
      // (HeteroDeviceSwitcher sets runtimeMode to 'none' when a device is selected).
      if (isDeviceMode) {
        return canPersistWorkingDirectory ? <WorkingDirectorySection agentId={agentId} /> : null;
      }

      // Web has no local filesystem — cloud / heterogeneous agents browse the repo
      // through the cloud repo switcher instead.
      if (!isDesktop) {
        return isHeterogeneous || alwaysShowWorkspace ? (
          <CloudRepoSwitcher agentId={agentId} />
        ) : null;
      }

      // Desktop: local working directory + git branch / diff / PR. Shown when the
      // run is local, or always for heterogeneous agents (they always have a cwd).
      if (alwaysShowWorkspace || runtimeMode === 'local') {
        return canPersistWorkingDirectory ? <WorkingDirectorySection agentId={agentId} /> : null;
      }

      return null;
    };

    return (
      <>
        <HeteroDeviceSwitcher agentId={agentId} />
        {renderWorkspace()}
      </>
    );
  },
);

WorkspaceControls.displayName = 'WorkspaceControls';

export default WorkspaceControls;
