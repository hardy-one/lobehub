import { DEFAULT_PROVIDER } from '@lobechat/business-const';
import { DEFAULT_MODEL, isDesktop } from '@lobechat/const';
import { Flexbox, TooltipGroup } from '@lobehub/ui';
import React, { memo, Suspense, useCallback } from 'react';

import DragUploadZone, { type DroppedLocalPath, useUploadFiles } from '@/components/DragUploadZone';
import Loading from '@/components/Loading/BrandTextLoading';
import { insertLocalPathTags } from '@/features/ChatInput/InputEditor/insertLocalFileTags';
import { useEffectiveAgentConfig } from '@/hooks/useEffectiveAgentConfig';
import { useEffectiveWorkingDirectory } from '@/hooks/useEffectiveWorkingDirectory';
import { useAgentStore } from '@/store/agent';
import { agentChatConfigSelectors, agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';

import ConversationArea from './ConversationArea';
import { useAgentContext } from './useAgentContext';

const wrapperStyle: React.CSSProperties = {
  flex: 1,
  height: '100%',
  minWidth: 300,
  width: '100%',
};

const ChatConversation = memo(() => {
  const context = useAgentContext();
  const { config, isModelLoading } = useEffectiveAgentConfig(context);
  const agentId = context.agentId;
  const model = config?.model ?? DEFAULT_MODEL;
  const provider = config?.provider ?? DEFAULT_PROVIDER;
  const isHeterogeneous = useAgentStore(agentSelectors.isCurrentAgentHeterogeneous);
  const isLocalSystemEnabled = useAgentStore(agentChatConfigSelectors.isLocalSystemEnabled);

  const { handleUploadFiles } = useUploadFiles({ agentId, model, provider });
  const workingDirectory = useEffectiveWorkingDirectory(agentId);

  const enableLocalPathReference =
    isDesktop && !!workingDirectory && (isHeterogeneous || isLocalSystemEnabled);

  const handleLocalPaths = useCallback((paths: DroppedLocalPath[]) => {
    const editor = useChatStore.getState().mainInputEditor?.instance;
    if (!editor) return;
    insertLocalPathTags(editor, paths);
  }, []);

  return (
    <Suspense fallback={<Loading debugId="Agent > ChatConversation" />}>
      <DragUploadZone
        enableLocalPathReference={enableLocalPathReference}
        style={wrapperStyle}
        onLocalPaths={enableLocalPathReference ? handleLocalPaths : undefined}
        onUploadFiles={(files) => (isModelLoading ? Promise.resolve() : handleUploadFiles(files))}
      >
        <Flexbox flex={1} height={'100%'} style={{ minWidth: 0 }}>
          <TooltipGroup>
            <ConversationArea />
          </TooltipGroup>
        </Flexbox>
      </DragUploadZone>
    </Suspense>
  );
});

ChatConversation.displayName = 'ChatConversation';

export default ChatConversation;
