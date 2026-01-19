'use client';

import { ActionIcon, Flexbox } from '@lobehub/ui';
import { ChatHeader } from '@lobehub/ui/mobile';
import { Clock, MessageSquarePlusIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ShareButton from '@/app/[variants]/(main)/agent/features/Conversation/Header/ShareButton';
import { MOBILE_HEADER_ICON_SIZE } from '@/const/layoutTokens';
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
  const [openNewTopicOrSaveTopic] = useChatStore((s) => [s.openNewTopicOrSaveTopic]);
  const { isValidating, mutate } = useActionSWR('openNewTopicOrSaveTopic', openNewTopicOrSaveTopic);

  return (
    <ChatHeader
      center={<ChatHeaderTitle />}
      onBackClick={() =>
        router.push('/agent', { query: { session: INBOX_SESSION_ID }, replace: true })
      }
      right={
        <Flexbox align={'center'} gap={4} horizontal>
          <ShareButton mobile open={open} setOpen={setOpen} />
          <ActionIcon
            icon={MessageSquarePlusIcon}
            loading={isValidating}
            onClick={() => {
              mutate();
            }}
            size={MOBILE_HEADER_ICON_SIZE}
            title={t('actions.addNewTopic')}
          />
          <ActionIcon
            icon={Clock}
            onClick={() => toggleMobileTopic(true)}
            size={MOBILE_HEADER_ICON_SIZE}
            title={t('guide.title')}
          />
        </Flexbox>
      }
      showBackButton
      style={{ width: '100%' }}
    />
  );
});

export default MobileHeader;
