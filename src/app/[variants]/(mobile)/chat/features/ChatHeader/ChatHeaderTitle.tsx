import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

const ChatHeaderTitle = memo(() => {
  const { t } = useTranslation(['topic', 'common']);
  const topic = useChatStore((s) => topicSelectors.currentActiveTopic(s));
  const [isInboxAgent, title] = useAgentStore((s) => [
    builtinAgentSelectors.isInboxAgent(s),
    agentSelectors.currentAgentTitle(s),
  ]);
  const isInbox = isInboxAgent;

  const displayTitle = isInbox ? 'Lobe AI' : title || t('defaultSession', { ns: 'common' });
  const topicTitle = topic?.title || t('title', { ns: 'topic' });
  const titlePadding = 88;
  const topicPadding = 96;
  const topicOffset = 9;

  return (
    <div
      style={{
        inset: 0,
        pointerEvents: 'none',
        position: 'absolute',
      }}
    >
      <div
        style={{
          boxSizing: 'border-box',
          fontSize: 16,
          fontWeight: 600,
          left: 0,
          lineHeight: 1.1,
          overflow: 'hidden',
          paddingInline: titlePadding,
          position: 'absolute',
          right: 0,
          textAlign: 'center',
          textOverflow: 'ellipsis',
          top: '50%',
          transform: 'translateY(-50%)',
          whiteSpace: 'nowrap',
        }}
      >
        {displayTitle}
      </div>
      <div
        style={{
          boxSizing: 'border-box',
          color: 'var(--colorTextSecondary)',
          fontSize: 12,
          left: 0,
          lineHeight: 1,
          overflow: 'hidden',
          paddingInline: topicPadding,
          position: 'absolute',
          right: 0,
          textAlign: 'center',
          textOverflow: 'ellipsis',
          top: '50%',
          transform: `translateY(${topicOffset}px)`,
          whiteSpace: 'nowrap',
        }}
      >
        {topicTitle}
      </div>
    </div>
  );
});

export default ChatHeaderTitle;
