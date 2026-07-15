'use client';

import { isDesktop } from '@lobechat/const';
import type { DeviceExecutionTarget, ExecutionTargetSelection } from '@lobechat/types';
import { useCallback } from 'react';

import { useEffectiveAgentConfig } from '@/hooks/useEffectiveAgentConfig';
import { gatewayConnectionService } from '@/services/electron/gatewayConnection';
import { useElectronStore } from '@/store/electron';
import { useUserStore } from '@/store/user';

import { useChatInputStore } from '../store';

export const useExecutionTargetPreference = (agentId?: string, topicId?: string | null) => {
  const {
    config,
    executionTargetError,
    hasSourcePreference,
    hasTopicPreference,
    isExecutionTargetLoading,
    retryExecutionTarget,
    workspaceScoped,
  } = useEffectiveAgentConfig({ agentId: agentId ?? '', topicId });
  const updateExecutionTargetPreference = useUserStore((s) => s.updateExecutionTargetPreference);

  const currentDeviceId = useElectronStore((s) =>
    isDesktop ? s.gatewayDeviceInfo?.deviceId : undefined,
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

  return {
    agencyConfig: config?.agencyConfig,
    error: executionTargetError,
    followAgentDefault,
    hasSourcePreference,
    hasTopicOverride: !!topicId && hasTopicPreference,
    isLoading: isExecutionTargetLoading,
    retry: retryExecutionTarget,
    selectExecutionTarget,
    topicId: topicId ?? undefined,
    workspaceScoped,
  };
};

export const useSelectExecutionTarget = (agentId: string) => {
  const topicId = useChatInputStore((s) => s.topicModelContext?.topicId);
  return useExecutionTargetPreference(agentId, topicId);
};
