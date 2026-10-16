'use client';

import { ActionIcon } from '@lobehub/ui';
import { MessageSquarePlusIcon } from 'lucide-react';
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
 *
 * Keeps the desktop sidebar entry's icon so the action reads the same on both
 * platforms.
 */
export const NewTopicButton = memo(() => {
  const { t } = useTranslation('topic');
  const { disabled, startNewTopic } = useStartNewTopic();

  return (
    <ActionIcon
      disabled={disabled}
      icon={MessageSquarePlusIcon}
      size={MOBILE_HEADER_ICON_SIZE}
      title={t('actions.addNewTopic')}
      tooltipProps={{ placement: 'bottom' }}
      onClick={startNewTopic}
    />
  );
});
