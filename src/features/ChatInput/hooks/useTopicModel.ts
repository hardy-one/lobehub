import type { MessageMapScope, TopicModelOverride } from '@lobechat/types';
import { useCallback } from 'react';

import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import {
  topicMapKeyFromContext,
  topicMapScopeFromMessageScope,
} from '@/store/chat/utils/topicMapKey';

import { useChatInputStore } from '../store';
import { useAgentId } from './useAgentId';

interface TopicModelContext {
  agentId: string;
  groupId?: string;
  scope?: MessageMapScope;
  topicId?: string | null;
}

export const useChatInputTopicModel = () => {
  const agentId = useAgentId();
  const context = useChatInputStore((s) => s.topicModelContext);

  return useTopicModel({ ...context, agentId });
};

export const useTopicModel = (context: TopicModelContext) => {
  const topicScope = topicMapScopeFromMessageScope(context.scope);
  const scopedAgentId = topicScope === 'group' ? undefined : context.agentId;
  const [topicOverride, topicInList, useFetchTopicModelOverride] = useChatStore((s) => {
    if (!context.topicId) return [undefined, false, s.useFetchTopicModelOverride] as const;

    const topic = s.topicDataMap[topicMapKeyFromContext(context)]?.items?.find(
      (item) => item.id === context.topicId,
    );

    return [
      topic
        ? topic.metadata?.modelOverride
        : (s.topicModelOverrideMap[context.topicId] ?? undefined),
      !!topic,
      s.useFetchTopicModelOverride,
    ] as const;
  });
  const { data: fetchedTopicOverride } = useFetchTopicModelOverride(
    context.topicId && !topicInList ? context.topicId : undefined,
  );
  const effectiveTopicOverride = topicOverride ?? fetchedTopicOverride ?? undefined;
  const updateTopicMetadata = useChatStore((s) => s.updateTopicMetadata);
  const [agentModel, agentProvider, updateAgentConfigById] = useAgentStore((s) => [
    agentByIdSelectors.getAgentModelById(context.agentId)(s),
    agentByIdSelectors.getAgentModelProviderById(context.agentId)(s),
    s.updateAgentConfigById,
  ]);

  const setModel = useCallback(
    async (next: TopicModelOverride) => {
      if (!context.topicId) {
        await updateAgentConfigById(context.agentId, next);
        return;
      }

      const modelOverride = { model: next.model, provider: next.provider };
      await updateTopicMetadata(
        context.topicId,
        { modelOverride },
        {
          agentId: scopedAgentId,
          groupId: context.groupId,
          scope: topicScope,
        },
      );
    },
    [
      context.agentId,
      context.groupId,
      context.topicId,
      scopedAgentId,
      topicScope,
      updateAgentConfigById,
      updateTopicMetadata,
    ],
  );

  return {
    model: effectiveTopicOverride?.model ?? agentModel,
    provider: effectiveTopicOverride?.provider ?? agentProvider,
    setModel,
  };
};
