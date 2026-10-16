'use client';

import { ActionIcon } from '@lobehub/ui';
import { MessageSquarePlus } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { MOBILE_HEADER_ICON_SIZE } from '@/const/layoutTokens';

import { useStartNewTopic } from './useStartNewTopic';

/**
 * Start a new topic from the mobile chat header.
 *
 * The header is the only always-visible surface on mobile. The shared topic
 * list renders its "Start New Topic" row only while the list is empty, which
 * left a session that already has topics with no way to start another one.
 */
export const NewTopicButton = memo(() => {
  const { t } = useTranslation('topic');
  const { disabled, startNewTopic } = useStartNewTopic();

  return (
    <ActionIcon
      disabled={disabled}
      icon={MessageSquarePlus}
      size={MOBILE_HEADER_ICON_SIZE}
      title={t('actions.addNewTopic')}
      tooltipProps={{ placement: 'bottom' }}
      onClick={startNewTopic}
    />
  );
});
