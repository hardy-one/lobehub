import { DEFAULT_PROVIDER } from '@lobechat/business-const';
import { DEFAULT_MODEL, isDesktop } from '@lobechat/const';
import { Flexbox, TooltipGroup } from '@lobehub/ui';
import React, { memo, Suspense, useCallback } from 'react';

import DragUploadZone, { type DroppedLocalPath, useUploadFiles } from '@/components/DragUploadZone';
import Loading from '@/components/Loading/BrandTextLoading';
import { insertLocalPathTags } from '@/features/ChatInput/InputEditor/insertLocalFileTags';
import { resolveExecutionTarget } from '@/helpers/executionTarget';
import { useIsGatewayModeEnabled } from '@/helpers/gatewayMode';
import { useEffectiveAgentConfig } from '@/hooks/useEffectiveAgentConfig';
import { useEffectiveWorkingDirectory } from '@/hooks/useEffectiveWorkingDirectory';
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
  const {
    config,
    executionTargetError,
    isExecutionTargetLoading,
    isModelLoading,
    isModelUnavailable,
    workspaceScoped,
  } = useEffectiveAgentConfig(context);
  const agentId = context.agentId;
  const model = config?.model ?? DEFAULT_MODEL;
  const provider = config?.provider ?? DEFAULT_PROVIDER;
  const isHeterogeneous = !!config?.agencyConfig?.heterogeneousProvider;
  const deviceRoutingAvailable = useIsGatewayModeEnabled(agentId);
  const executionTarget = resolveExecutionTarget(config?.agencyConfig, {
    clientExecutionAvailable: isDesktop,
    deviceRoutingAvailable,
    isHetero: isHeterogeneous,
    workspaceScoped,
  });

  const { handleUploadFiles } = useUploadFiles({ agentId, model, provider });
  const workingDirectory = useEffectiveWorkingDirectory(context);

  const enableLocalPathReference =
    !executionTargetError &&
    !isExecutionTargetLoading &&
    isDesktop &&
    !!workingDirectory &&
    (isHeterogeneous || executionTarget === 'local');

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
        onUploadFiles={(files) =>
          isModelLoading || isModelUnavailable ? Promise.resolve() : handleUploadFiles(files)
        }
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
