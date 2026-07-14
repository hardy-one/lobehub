'use client';

import { isDesktop } from '@lobechat/const';
import type { DeviceExecutionTarget, ExecutionTargetSelection } from '@lobechat/types';
import { useCallback } from 'react';

import { resolveEffectiveExecutionTargetConfig } from '@/helpers/executionTarget';
import { gatewayConnectionService } from '@/services/electron/gatewayConnection';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useElectronStore } from '@/store/electron';
import { useUserStore } from '@/store/user';
import { workspaceUserSettingsSelectors } from '@/store/user/selectors';
import {
  agentExecutionTargetPreferenceKey,
  topicExecutionTargetPreferenceKey,
} from '@/store/user/slices/executionTargetPreference/initialState';

import { useChatInputStore } from '../store';

export const useExecutionTargetPreference = (agentId?: string, topicId?: string | null) => {
  const resolvedAgentId = agentId ?? '';
  const sharedAgencyConfig = useAgentStore(agentByIdSelectors.getAgencyConfigById(resolvedAgentId));
  const isWorkspaceAgent = useAgentStore(agentByIdSelectors.isWorkspaceAgentById(resolvedAgentId));
  const workspaceOverride = useUserStore(
    workspaceUserSettingsSelectors.agentDeviceOverrideById(resolvedAgentId),
  );
  const agentPreference = useUserStore(
    (s) => s.executionTargetPreferenceMap[agentExecutionTargetPreferenceKey(resolvedAgentId)],
  );
  const topicPreference = useUserStore((s) =>
    topicId
      ? s.executionTargetPreferenceMap[topicExecutionTargetPreferenceKey(topicId)]
      : undefined,
  );
  const useFetchExecutionTargetPreference = useUserStore(
    (s) => s.useFetchExecutionTargetPreference,
  );
  const updateExecutionTargetPreference = useUserStore((s) => s.updateExecutionTargetPreference);
  const useFetchWorkspaceUserPreference = useUserStore((s) => s.useFetchWorkspaceUserPreference);

  const preferenceSWR = useFetchExecutionTargetPreference(
    agentId ? { agentId, ...(topicId ? { topicId } : {}) } : undefined,
  );
  const workspaceSWR = useFetchWorkspaceUserPreference();

  const currentDeviceId = useElectronStore((s) =>
    isDesktop ? s.gatewayDeviceInfo?.deviceId : undefined,
  );
  const agencyConfig = resolveEffectiveExecutionTargetConfig(
    sharedAgencyConfig,
    workspaceOverride,
    agentPreference,
    topicPreference,
  );

  const selectExecutionTarget = useCallback(
    async (target: DeviceExecutionTarget, deviceId?: string) => {
      if (!agentId) throw new Error('Agent id is required');
      let boundDeviceId = target === 'device' ? deviceId : undefined;

      if (target === 'local') {
        boundDeviceId = currentDeviceId;
        if (!boundDeviceId) {
          boundDeviceId = (await gatewayConnectionService.getDeviceInfo())?.deviceId;
        }
      }

      if ((target === 'device' || target === 'local') && !boundDeviceId) {
        throw new Error(`Execution target ${target} requires a bound device`);
      }

      const selection: ExecutionTargetSelection = {
        ...(boundDeviceId ? { boundDeviceId } : {}),
        executionTarget: target,
      };

      await updateExecutionTargetPreference({
        agentId,
        selection,
        ...(topicId ? { topicId } : {}),
      });
    },
    [agentId, currentDeviceId, topicId, updateExecutionTargetPreference],
  );

  const followAgentDefault = useCallback(async () => {
    if (!agentId || !topicId) return;
    await updateExecutionTargetPreference({ agentId, selection: null, topicId });
  }, [agentId, topicId, updateExecutionTargetPreference]);

  const retry = useCallback(async () => {
    await Promise.all([
      preferenceSWR.mutate(),
      ...(isWorkspaceAgent ? [workspaceSWR.mutate()] : []),
    ]);
  }, [isWorkspaceAgent, preferenceSWR, workspaceSWR]);

  return {
    agencyConfig,
    error: preferenceSWR.error ?? (isWorkspaceAgent ? workspaceSWR.error : undefined),
    followAgentDefault,
    hasSourcePreference: agentPreference != null || topicPreference != null,
    hasTopicOverride: !!topicId && topicPreference != null,
    isLoading: preferenceSWR.isLoading || (isWorkspaceAgent && workspaceSWR.isLoading),
    retry,
    selectExecutionTarget,
    topicId: topicId ?? undefined,
  };
};

export const useSelectExecutionTarget = (agentId: string) => {
  const topicId = useChatInputStore((s) => s.topicModelContext?.topicId);
  return useExecutionTargetPreference(agentId, topicId);
};
