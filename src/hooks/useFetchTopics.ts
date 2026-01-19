import { useEffect } from 'react';
import { useParams } from 'react-router-dom';

import { INBOX_SESSION_ID } from '@/const/session';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

/**
 * Fetch topics for the current session (agent or group)
 */
export const useFetchTopics = (options?: { excludeTriggers?: string[] }) => {
  const isInboxAgent = useAgentStore(builtinAgentSelectors.isInboxAgent);
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const [activeAgentId, activeGroupId, useFetchTopicsHook] = useChatStore((s) => [
    s.activeAgentId,
    s.activeGroupId,
    s.useFetchTopics,
  ]);
  const params = useParams<{ aid?: string }>();
  const isInboxRoute = params.aid === INBOX_SESSION_ID;
  const resolvedAgentId = isInboxRoute ? inboxAgentId || activeAgentId : activeAgentId;
  const isInbox = isInboxRoute ? Boolean(resolvedAgentId) : isInboxAgent;

  const topicPageSize = useGlobalStore(systemStatusSelectors.topicPageSize);

  // If in group session, use groupId; otherwise use agentId
  const { isValidating, data } = useFetchTopicsHook(true, {
    agentId: resolvedAgentId,
    ...(options?.excludeTriggers && options.excludeTriggers.length > 0
      ? { excludeTriggers: options.excludeTriggers }
      : {}),
    groupId: activeGroupId,
    isInbox: activeGroupId ? false : isInbox,
    pageSize: topicPageSize,
  });

  return {
    // isRevalidating: 有缓存数据，后台正在更新
    isRevalidating: isValidating && !!data,
  };
};
