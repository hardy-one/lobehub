'use client';

import { ActionIcon, Flexbox } from '@lobehub/ui';
import { ChatHeader } from '@lobehub/ui/mobile';
import { MessageSquarePlusIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ShareButton from '@/app/[variants]/(main)/chat/features/Conversation/Header/ShareButton';
import { INBOX_SESSION_ID } from '@/const/session';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useActionSWR } from '@/libs/swr';
import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';

import ChatHeaderTitle from './ChatHeaderTitle';

const MobileHeader = memo(() => {
  const { t } = useTranslation('topic');
  const router = useQueryRoute();
  const [open, setOpen] = useState(false);
  const toggleMobileTopic = useGlobalStore((s) => s.toggleMobileTopic);
  const openNewTopicOrSaveTopic = useChatStore((s) => s.openNewTopicOrSaveTopic);

  const { mutate, isValidating } = useActionSWR('openNewTopicOrSaveTopic', openNewTopicOrSaveTopic);

  const handleNewTopic = () => {
    mutate();
    // Close mobile topic modal after creating new topic
    toggleMobileTopic(false);
  };

  return (
    <ChatHeader
      center={<ChatHeaderTitle />}
      onBackClick={() =>
        router.push('/agent', { query: { session: INBOX_SESSION_ID }, replace: true })
      }
      right={
        <Flexbox align={'center'} gap={4} horizontal>
          <ActionIcon
            icon={MessageSquarePlusIcon}
            loading={isValidating}
            onClick={handleNewTopic}
            size={'small'}
            title={t('actions.addNewTopic')}
          />
          <ShareButton mobile open={open} setOpen={setOpen} />
        </Flexbox>
      }
      showBackButton
      style={{ width: '100%' }}
    />
  );
});

export default MobileHeader;
