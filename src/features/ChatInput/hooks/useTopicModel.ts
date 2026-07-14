import { DEFAULT_PROVIDER } from '@lobechat/business-const';
import { DEFAULT_MODEL } from '@lobechat/const';
import type { MessageMapScope, TopicModelOverride } from '@lobechat/types';
import { useCallback } from 'react';

import { useEffectiveAgentConfig } from '@/hooks/useEffectiveAgentConfig';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { topicMapScopeFromMessageScope } from '@/store/chat/utils/topicMapKey';

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
  const { config, isModelLoading, modelError, retryModel } = useEffectiveAgentConfig(context);
  const updateTopicMetadata = useChatStore((s) => s.updateTopicMetadata);
  const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);

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
    error: modelError,
    isLoading: isModelLoading,
    model: config?.model ?? DEFAULT_MODEL,
    provider: config?.provider ?? DEFAULT_PROVIDER,
    retry: retryModel,
    setModel,
  };
};
