import { usePrevious, useUnmount } from 'ahooks';
import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { createStoreUpdater } from 'zustand-utils';

import { INBOX_SESSION_ID } from '@/const/session';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';

const AgentIdSync = () => {
  const useStoreUpdater = createStoreUpdater(useAgentStore);
  const useChatStoreUpdater = createStoreUpdater(useChatStore);
  const params = useParams<{ aid?: string }>();

  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const isInboxRoute = params.aid === INBOX_SESSION_ID;

  const resolvedAgentId = isInboxRoute ? inboxAgentId : params.aid;
  const prevAgentId = usePrevious(resolvedAgentId);

  useStoreUpdater('activeAgentId', resolvedAgentId);
  useChatStoreUpdater('activeAgentId', resolvedAgentId ?? '');

  useEffect(() => {
    if (isInboxRoute && !inboxAgentId) {
      useAgentStore.setState({ activeAgentId: undefined });
      useChatStore.setState({ activeAgentId: '' });
    }
  }, [inboxAgentId, isInboxRoute]);

  // Reset activeTopicId when switching to a different agent
  // This prevents messages from being saved to the wrong topic bucket
  useEffect(() => {
    // Only reset topic when switching between agents (not on initial mount)
    if (prevAgentId !== undefined && prevAgentId !== resolvedAgentId) {
      useChatStore.getState().switchTopic(null, { skipRefreshMessage: true });
    }
  }, [prevAgentId, resolvedAgentId]);

  // Clear activeAgentId when unmounting (leaving chat page)
  useUnmount(() => {
    useAgentStore.setState({ activeAgentId: undefined }, false, 'AgentIdSync/unmountAgentId');
    useChatStore.setState(
      { activeAgentId: undefined, activeTopicId: undefined },
      false,
      'AgentIdSync/unmountAgentId',
    );
  });

  return null;
};

export default AgentIdSync;
