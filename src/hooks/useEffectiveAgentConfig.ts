'use client';

import type {
  ChatTopicMetadata,
  ConversationContext,
  ExecutionTargetSelection,
  LobeAgentAgencyConfig,
  LobeAgentConfig,
  TopicModelOverride,
} from '@lobechat/types';
import { useCallback, useMemo } from 'react';

import { resolveEffectiveExecutionTargetConfig } from '@/helpers/executionTarget';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicMapKeyFromContext } from '@/store/chat/utils/topicMapKey';
import { useUserStore } from '@/store/user';
import { workspaceUserSettingsSelectors } from '@/store/user/selectors';
import {
  agentExecutionTargetPreferenceKey,
  topicExecutionTargetPreferenceKey,
} from '@/store/user/slices/executionTargetPreference/initialState';

export type EffectiveAgentConfigContext = Pick<
  ConversationContext,
  'agentId' | 'groupId' | 'scope' | 'topicId'
>;

interface ResolveEffectiveAgentConfigParams {
  agentConfig?: LobeAgentConfig;
  agentPreference?: ExecutionTargetSelection | null;
  topicModelOverride?: TopicModelOverride | null;
  topicPreference?: ExecutionTargetSelection | null;
  workspaceOverride?: Pick<LobeAgentAgencyConfig, 'boundDeviceId' | 'executionTarget'>;
}

export const resolveEffectiveAgentConfig = ({
  agentConfig,
  agentPreference,
  topicModelOverride,
  topicPreference,
  workspaceOverride,
}: ResolveEffectiveAgentConfigParams): LobeAgentConfig | undefined => {
  if (!agentConfig) return;

  const agencyConfig = resolveEffectiveExecutionTargetConfig(
    agentConfig.agencyConfig,
    workspaceOverride,
    agentPreference,
    topicPreference,
  );
  const model = topicModelOverride?.model ?? agentConfig.model;
  const provider = topicModelOverride?.provider ?? agentConfig.provider;

  if (
    agencyConfig === agentConfig.agencyConfig &&
    model === agentConfig.model &&
    provider === agentConfig.provider
  ) {
    return agentConfig;
  }

  return { ...agentConfig, agencyConfig, model, provider };
};

export const useEffectiveAgentConfig = (context: EffectiveAgentConfigContext) => {
  const { agentId, topicId } = context;
  const [
    agentConfig,
    agentConfigError,
    isAgentConfigLoading,
    isWorkspaceAgent,
    retryAgentConfigFetch,
  ] = useAgentStore((s) => [
    s.agentMap[agentId] as LobeAgentConfig | undefined,
    agentByIdSelectors.getAgentConfigErrorById(agentId)(s),
    agentByIdSelectors.isAgentConfigLoadingById(agentId)(s),
    agentByIdSelectors.isWorkspaceAgentById(agentId)(s),
    s.retryAgentConfigFetch,
  ]);
  const [cachedTopicModelOverride, topicInList, topicMetadata, useFetchTopicModelOverride] =
    useChatStore((s) => {
      if (!topicId) {
        return [undefined, false, undefined, s.useFetchTopicModelOverride] as const;
      }

      const topic = s.topicDataMap[topicMapKeyFromContext(context)]?.items?.find(
        (item) => item.id === topicId,
      );

      return [
        s.topicModelOverrideMap[topicId],
        !!topic,
        topic?.metadata,
        s.useFetchTopicModelOverride,
      ] as const;
    });
  const shouldFetchTopicModel = !!topicId && !topicInList;
  const topicModelSWR = useFetchTopicModelOverride(shouldFetchTopicModel ? topicId : undefined);
  const topicModelOverride = topicInList
    ? (topicMetadata?.modelOverride ?? null)
    : cachedTopicModelOverride !== undefined
      ? cachedTopicModelOverride
      : topicModelSWR.data;

  const workspaceOverride = useUserStore(
    workspaceUserSettingsSelectors.agentDeviceOverrideById(agentId),
  );
  const [cachedAgentPreference, cachedTopicPreference, useFetchExecutionTargetPreference] =
    useUserStore((s) => [
      s.executionTargetPreferenceMap[agentExecutionTargetPreferenceKey(agentId)],
      topicId ? s.executionTargetPreferenceMap[topicExecutionTargetPreferenceKey(topicId)] : null,
      s.useFetchExecutionTargetPreference,
    ]);
  const useFetchWorkspaceUserPreference = useUserStore((s) => s.useFetchWorkspaceUserPreference);
  const preferenceSWR = useFetchExecutionTargetPreference(
    agentId ? { agentId, ...(topicId ? { topicId } : {}) } : undefined,
  );
  const workspaceSWR = useFetchWorkspaceUserPreference();
  const agentPreference =
    cachedAgentPreference !== undefined ? cachedAgentPreference : preferenceSWR.data?.agent;
  const topicPreference = topicId
    ? cachedTopicPreference !== undefined
      ? cachedTopicPreference
      : preferenceSWR.data?.topic
    : null;

  const config = useMemo(
    () =>
      resolveEffectiveAgentConfig({
        agentConfig,
        agentPreference,
        topicModelOverride,
        topicPreference,
        workspaceOverride,
      }),
    [agentConfig, agentPreference, topicModelOverride, topicPreference, workspaceOverride],
  );

  const hasSourcePreference = agentPreference != null || topicPreference != null;
  const topicModelLoading =
    shouldFetchTopicModel && topicModelOverride === undefined && !topicModelSWR.error;
  const topicModelUnavailable =
    shouldFetchTopicModel && topicModelOverride === undefined && !!topicModelSWR.error;
  const preferenceLoading =
    !!agentId &&
    (agentPreference === undefined || (!!topicId && topicPreference === undefined)) &&
    !preferenceSWR.error;
  const workspacePreferenceLoading = isWorkspaceAgent && workspaceSWR.isLoading;
  const agentConfigLoading = isAgentConfigLoading && !agentConfigError;
  const unavailableAgentConfigError = !agentConfig ? agentConfigError : undefined;
  const modelError = unavailableAgentConfigError ?? topicModelSWR.error;
  const executionTargetError =
    unavailableAgentConfigError ??
    preferenceSWR.error ??
    (isWorkspaceAgent ? workspaceSWR.error : undefined);
  const isModelLoading = agentConfigLoading || topicModelLoading;
  const isModelUnavailable = (!!agentConfigError && !agentConfig) || topicModelUnavailable;
  const isExecutionTargetLoading =
    agentConfigLoading || preferenceLoading || workspacePreferenceLoading;

  const retryAgentConfig = useCallback(async () => {
    if (unavailableAgentConfigError) await retryAgentConfigFetch(agentId);
  }, [agentId, retryAgentConfigFetch, unavailableAgentConfigError]);
  const retryTopicModel = useCallback(async () => {
    if (shouldFetchTopicModel) await topicModelSWR.mutate();
  }, [shouldFetchTopicModel, topicModelSWR]);
  const retryPreferences = useCallback(async () => {
    await Promise.all([
      preferenceSWR.mutate(),
      ...(isWorkspaceAgent ? [workspaceSWR.mutate()] : []),
    ]);
  }, [isWorkspaceAgent, preferenceSWR, workspaceSWR]);
  const retryModel = useCallback(async () => {
    await Promise.all([retryAgentConfig(), retryTopicModel()]);
  }, [retryAgentConfig, retryTopicModel]);
  const retryExecutionTarget = useCallback(async () => {
    await Promise.all([retryAgentConfig(), retryPreferences()]);
  }, [retryAgentConfig, retryPreferences]);
  const retry = useCallback(async () => {
    await Promise.all([retryAgentConfig(), retryTopicModel(), retryPreferences()]);
  }, [retryAgentConfig, retryPreferences, retryTopicModel]);

  return {
    config,
    error: modelError ?? executionTargetError,
    executionTargetError,
    hasSourcePreference,
    hasTopicPreference: topicPreference != null,
    hasWorkspaceOverride: workspaceOverride != null,
    isExecutionTargetLoading,
    isLoading: isModelLoading || isExecutionTargetLoading,
    isModelLoading,
    isModelUnavailable,
    isWorkspaceAgent,
    modelError,
    retry,
    retryExecutionTarget,
    retryModel,
    topicMetadata: topicMetadata as ChatTopicMetadata | undefined,
    topicModelError: topicModelSWR.error,
    topicModelOverride,
    workspaceScoped: isWorkspaceAgent && !hasSourcePreference,
  };
};
