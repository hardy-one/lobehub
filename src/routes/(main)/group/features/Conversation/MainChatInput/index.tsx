'use client';

import { memo } from 'react';

import AsyncError from '@/components/AsyncError';
import { type ActionKeys } from '@/features/ChatInput';
import { ChatInput } from '@/features/Conversation';
import { contextSelectors, useConversationStore } from '@/features/Conversation/store';
import { useEffectiveAgentConfig } from '@/hooks/useEffectiveAgentConfig';
import { useChatStore } from '@/store/chat';

import { useSendMenuItems } from './useSendMenuItems';

const leftActions: ActionKeys[] = [
  'model',
  'search',
  'memory',
  'fileUpload',
  'tools',
  '---',
  ['typo', 'params', 'clear'],
];

const rightActions: ActionKeys[] = ['contextWindow'];

/**
 * MainChatInput
 *
 * Custom ChatInput implementation for main chat page.
 * Uses ChatInput from @/features/Conversation which handles all send logic
 * including error alerts display.
 * Only adds MessageFromUrl for desktop mode.
 */
const MainChatInput = memo(() => {
  const sendMenuItems = useSendMenuItems();
  const context = useConversationStore(contextSelectors.context);
  const { isModelLoading, isModelUnavailable, modelError, retryModel, topicModelError } =
    useEffectiveAgentConfig(context);

  return (
    <>
      {isModelUnavailable && modelError && !topicModelError && (
        <AsyncError
          error={modelError}
          variant={'inline'}
          onRetry={() => {
            void retryModel();
          }}
        />
      )}
      <ChatInput
        skipScrollMarginWithList
        isConfigLoading={isModelLoading || isModelUnavailable}
        leftActions={leftActions}
        rightActions={rightActions}
        sendMenu={{ items: sendMenuItems }}
        onEditorReady={(instance) => {
          // Sync to global ChatStore for compatibility with other features
          useChatStore.setState({ mainInputEditor: instance });
        }}
      />
    </>
  );
});

MainChatInput.displayName = 'MainChatInput';

export default MainChatInput;
