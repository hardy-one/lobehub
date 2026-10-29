'use client';

import { Flexbox } from '@lobehub/ui';
import { ChatHeader } from '@lobehub/ui/mobile';
import { memo, useState } from 'react';

import TopicCommentButton from '@/features/TopicComment/TopicCommentButton';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import ShareButton from '@/routes/(main)/agent/features/Conversation/Header/ShareButton';

import ChatHeaderTitle from './ChatHeaderTitle';
import { NewTopicButton } from './NewTopicButton';

const MobileHeader = memo(() => {
  const router = useQueryRoute();
  const [open, setOpen] = useState(false);

  return (
    <ChatHeader
      showBackButton
      center={<ChatHeaderTitle />}
      style={{ width: '100%' }}
      right={
        <Flexbox horizontal align={'center'} gap={4}>
          <NewTopicButton />
          <TopicCommentButton mobile />
          <ShareButton mobile open={open} setOpen={setOpen} />
        </Flexbox>
      }
      // Slots default to equal widths, which pins the title to the viewport centre;
      // with three action icons facing a single back arrow it then reads as glued
      // to the icons. Size the side slots to their content instead and let the
      // centre take the rest, so the gaps on both sides match.
      styles={{
        center: { flex: '1 1 0%' },
        left: { flex: '0 0 auto' },
        right: { flex: '0 0 auto' },
      }}
      onBackClick={() =>
        // `/agent` index redirects to `..` (mobile home / session list), preserving
        // workspace scope; the old `?session=` query was never read by the target.
        router.push('/agent', { replace: true })
      }
    />
  );
});

export default MobileHeader;
