import { Flexbox } from '@lobehub/ui';
import { useEffect, useRef } from 'react';

import TopicList from '@/app/[variants]/(main)/agent/_layout/Sidebar/Topic/List';
import TopicSearchBar from '@/app/[variants]/(main)/agent/_layout/Sidebar/Topic/TopicSearchBar';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import TopicModal from './features/TopicModal';

const Topic = () => {
  const totalCount = useChatStore((s) => topicSelectors.currentTopicCount(s));
  const [isOpen, topicPageSize, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.mobileShowTopic(s),
    systemStatusSelectors.topicPageSize(s),
    s.updateSystemStatus,
  ]);
  const previousPageSizeRef = useRef<number | null>(null);

  useEffect(() => {
    if (isOpen) {
      if (previousPageSizeRef.current === null) previousPageSizeRef.current = topicPageSize;

      if (totalCount > 0 && topicPageSize <= totalCount) {
        updateSystemStatus({ topicPageSize: totalCount + 1 });
      }

      return;
    }

    if (previousPageSizeRef.current !== null) {
      updateSystemStatus({ topicPageSize: previousPageSizeRef.current });
      previousPageSizeRef.current = null;
    }
  }, [isOpen, topicPageSize, totalCount, updateSystemStatus]);

  useEffect(() => {
    return () => {
      if (previousPageSizeRef.current !== null) {
        updateSystemStatus({ topicPageSize: previousPageSizeRef.current });
        previousPageSizeRef.current = null;
      }
    };
  }, [updateSystemStatus]);

  return (
    <TopicModal>
      <Flexbox gap={8} height={'100%'} padding={'8px 8px 0'} style={{ overflow: 'hidden' }}>
        <TopicSearchBar />
        <Flexbox
          height={'100%'}
          style={{ marginInline: -8, overflowX: 'hidden', overflowY: 'auto', position: 'relative' }}
          width={'calc(100% + 16px)'}
        >
          <TopicList />
        </Flexbox>
      </Flexbox>
    </TopicModal>
  );
};

export default Topic;
