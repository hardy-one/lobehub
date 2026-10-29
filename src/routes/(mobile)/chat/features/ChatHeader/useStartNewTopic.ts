'use client';

import { useCallback } from 'react';
import urlJoin from 'url-join';

import { usePermission } from '@/hooks/usePermission';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useActionSWR } from '@/libs/swr';
import { topicActionKeys } from '@/libs/swr/keys';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

/**
 * Start a new topic from a header entry.
 *
 * `disabled` is the whole blocked window, not just the permission: while a send
 * from the new-topic view is in flight that send owns topic creation, so
 * `openNewTopicOrSaveTopic` is a no-op and the entry must show that instead of
 * swallowing the click.
 */
export const useStartNewTopic = () => {
  const router = useQueryRoute();
  const { allowed: canCreateTopic } = usePermission('create_content');
  const [agentId, openNewTopicOrSaveTopic] = useChatStore((s) => [
    s.activeAgentId,
    s.openNewTopicOrSaveTopic,
  ]);
  const isNewTopicSendInFlight = useChatStore(topicSelectors.isNewTopicSendInFlight);
  const { mutate } = useActionSWR(topicActionKeys.openNewOrSave(), openNewTopicOrSaveTopic);

  const disabled = !canCreateTopic || isNewTopicSendInFlight;

  const startNewTopic = useCallback(() => {
    if (disabled) return;

    // Land on the bare agent URL first: it drops any `:topicId` segment and any
    // sub-route, so the new topic is never conflated with the previous URL.
    if (agentId) router.push(urlJoin('/agent', agentId));

    mutate();
  }, [agentId, disabled, mutate, router]);

  return { disabled, startNewTopic };
};
