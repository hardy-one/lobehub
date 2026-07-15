import { DEFAULT_PROVIDER } from '@lobechat/business-const';
import { DEFAULT_MODEL } from '@lobechat/const';
import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import DragUploadZone, { useUploadFiles } from '@/components/DragUploadZone';
import { useEffectiveAgentConfig } from '@/hooks/useEffectiveAgentConfig';

import ConversationArea from './ConversationArea';
import ChatHeader from './Header';
import { useGroupContext } from './useGroupContext';

const ChatConversation = memo(() => {
  const context = useGroupContext();
  const { config, isModelLoading, isModelUnavailable } = useEffectiveAgentConfig(context);
  const agentId = context.agentId;
  const model = config?.model ?? DEFAULT_MODEL;
  const provider = config?.provider ?? DEFAULT_PROVIDER;
  const { handleUploadFiles } = useUploadFiles({ agentId, model, provider });

  return (
    <DragUploadZone
      style={{ height: '100%', width: '100%' }}
      onUploadFiles={(files) =>
        isModelLoading || isModelUnavailable ? Promise.resolve() : handleUploadFiles(files)
      }
    >
      <Flexbox height={'100%'} style={{ overflow: 'hidden', position: 'relative' }} width={'100%'}>
        <ChatHeader />
        <ConversationArea />
      </Flexbox>
    </DragUploadZone>
  );
});

ChatConversation.displayName = 'ChatConversation';

export default ChatConversation;
