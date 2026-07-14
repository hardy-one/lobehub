'use client';

import type { ConversationContext, LobeAgentConfig, TopicModelOverride } from '@lobechat/types';
import { useCallback, useMemo } from 'react';

import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicMapKeyFromContext } from '@/store/chat/utils/topicMapKey';

export type EffectiveAgentConfigContext = Pick<
  ConversationContext,
  'agentId' | 'groupId' | 'scope' | 'topicId'
>;

interface ResolveEffectiveAgentConfigParams {
  agentConfig?: LobeAgentConfig;
  topicModelOverride?: TopicModelOverride | null;
}

export const resolveEffectiveAgentConfig = ({
  agentConfig,
  topicModelOverride,
}: ResolveEffectiveAgentConfigParams): LobeAgentConfig | undefined => {
  if (!agentConfig) return;

  const model = topicModelOverride?.model ?? agentConfig.model;
  const provider = topicModelOverride?.provider ?? agentConfig.provider;

  if (model === agentConfig.model && provider === agentConfig.provider) return agentConfig;

  return { ...agentConfig, model, provider };
};

export const useEffectiveAgentConfig = (context: EffectiveAgentConfigContext) => {
  const { agentId, topicId } = context;
  const [agentConfig, agentConfigError, isAgentConfigLoading] = useAgentStore((s) => [
    s.agentMap[agentId] as LobeAgentConfig | undefined,
    agentByIdSelectors.getAgentConfigErrorById(agentId)(s),
    agentByIdSelectors.isAgentConfigLoadingById(agentId)(s),
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

  const config = useMemo(
    () => resolveEffectiveAgentConfig({ agentConfig, topicModelOverride }),
    [agentConfig, topicModelOverride],
  );
  const topicModelLoading =
    shouldFetchTopicModel && topicModelOverride === undefined && !topicModelSWR.error;
  const modelError = agentConfigError ?? topicModelSWR.error;
  const isModelLoading = (isAgentConfigLoading && !agentConfigError) || topicModelLoading;
  const retryModel = useCallback(async () => {
    if (shouldFetchTopicModel) await topicModelSWR.mutate();
  }, [shouldFetchTopicModel, topicModelSWR]);

  return {
    config,
    error: modelError,
    isLoading: isModelLoading,
    isModelLoading,
    modelError,
    retry: retryModel,
    retryModel,
    topicMetadata,
    topicModelOverride,
  };
};
