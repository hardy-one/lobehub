import { getBuiltinRender } from '@lobechat/builtin-tools/renders';
import { getBuiltinStreaming } from '@lobechat/builtin-tools/streamings';
import { Accordion, Divider, Flexbox, Skeleton } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo, useMemo, useState } from 'react';

import SafeBoundary from '@/components/ErrorBoundary';
import dynamic from '@/libs/next/dynamic';
import { useToolStore } from '@/store/tool';
import { toolSelectors } from '@/store/tool/selectors';
import { type MetaData } from '@/types/meta';

import { dataSelectors, useConversationStore } from '../../../store';
import Actions from './Actions';
import Detail from './Detail';
import Inspectors from './Inspector';
import { hasToolResultBody } from './toolResultBody';
import { useToolExpandState } from './useToolExpandState';

const Debug = dynamic(() => import('./Debug'), {
  loading: () => <Skeleton height={300} width={'100%'} />,
  ssr: false,
});

export interface GroupToolProps {
  assistantMessageId: string;
  disableEditing?: boolean;
  id: string;
  /**
   * Whether this call is the one still running. Decided by `Tools` for the
   * whole block: the operation flags it derives from are per message, so a row
   * cannot tell "running" from "waiting behind a sibling" on its own.
   */
  isExecuting?: boolean;
  /** Resolved once per tool list by `Tools` instead of per row. */
  pluginMeta?: MetaData;
}

const Tool = memo<GroupToolProps>(
  ({ assistantMessageId, disableEditing, id, isExecuting, pluginMeta }) => {
    // Subscribe directly to this tool's data so a streaming chunk that only
    // updates a sibling tool does not push new props through this subtree.
    const tool = useConversationStore(
      dataSelectors.getToolInBlock(assistantMessageId, id),
      isEqual,
    );

    // Stable defaults so downstream hook ordering is preserved even on the brief
    // window where the tool is not yet present in the store snapshot.
    const apiName = tool?.apiName ?? '';
    const identifier = tool?.identifier ?? '';
    const requestArgs = tool?.arguments;
    const intervention = tool?.intervention;
    const result = tool?.result;
    const type = tool?.type;
    const toolMessageId = tool?.result_msg_id;

    // Get renderDisplayControl from manifest. `result.state` lets an API whose
    // output shape varies by target refine it — CC `Read` expands once the result
    // turns out to be an image, and stays collapsed for source text.
    const renderDisplayControl = useToolStore(
      toolSelectors.getRenderDisplayControl(identifier, apiName, result?.state),
    );
    const isPending = intervention?.status === 'pending';
    const isReject = intervention?.status === 'rejected';
    const isAbort = intervention?.status === 'aborted';
    const needExpand = renderDisplayControl !== 'collapsed' || isPending;
    const isAlwaysExpand = renderDisplayControl === 'alwaysExpand';

    const { handleExpand, setShowDebug, showDebug, showToolRender } = useToolExpandState({
      isAlwaysExpand,
      needExpand,
    });
    // Controls switching between custom render and fallback ArgumentRender
    const [showCustomToolRender, setShowCustomToolRender] = useState(true);

    // Arguments only stop being complete JSON while they are still streaming,
    // so the parse result is cached per string. Re-parsing on every render of
    // every row of a long tool list was pure waste.
    const isArgumentsStreaming = useMemo(() => {
      if (!requestArgs) return false;
      try {
        JSON.parse(requestArgs);
        return false;
      } catch {
        return true;
      }
    }, [requestArgs]);

    const hasStreamingRenderer = !!getBuiltinStreaming(identifier, apiName);
    const forceShowStreamingRender = isArgumentsStreaming && hasStreamingRenderer;

    // Whether this call is still executing is decided once per block by `Tools`.
    // This tool's own result is the source of truth for completion: a finished
    // tool must never read as loading just because a sibling is still running.
    const hasError = !!result?.error;
    const hasFinishedResult = hasError || hasToolResultBody(result);
    const isToolCalling = !!isExecuting && !hasFinishedResult;
    const toolCallStartTime = useConversationStore(
      dataSelectors.getToolMessageCreatedAt(toolMessageId),
    );

    const hasCustomRender = !!getBuiltinRender(identifier, apiName);
    // Only allow toggle when has custom render and not in pending/reject/abort state
    const canToggleCustomToolRender = hasCustomRender && !isPending && !isReject && !isAbort;

    if (!tool) return null;

    const isToolDetailExpand = forceShowStreamingRender || showToolRender || showDebug;

    return (
      <Accordion
        hideIndicator={isAlwaysExpand}
        indicatorPlacement="inline"
        styles={{ trigger: { paddingBlock: 4, paddingInline: 4 } }}
        value={isToolDetailExpand ? [id] : []}
        items={[
          {
            action: !disableEditing && (
              <Actions
                assistantMessageId={assistantMessageId}
                canToggleCustomToolRender={canToggleCustomToolRender}
                identifier={identifier}
                setShowCustomToolRender={setShowCustomToolRender}
                setShowDebug={setShowDebug}
                showCustomToolRender={showCustomToolRender}
                showDebug={showDebug}
              />
            ),
            children: (
              <Flexbox gap={8} paddingBlock={8}>
                {showDebug && (
                  <Debug
                    apiName={apiName}
                    identifier={identifier}
                    intervention={intervention}
                    requestArgs={requestArgs}
                    result={result}
                    toolCallId={id}
                    toolMessageId={toolMessageId}
                    type={type}
                  />
                )}
                <SafeBoundary alertTitle={`${identifier} / ${apiName}`} variant="alert">
                  <Detail
                    apiName={apiName}
                    arguments={requestArgs}
                    disableEditing={disableEditing}
                    identifier={identifier}
                    intervention={intervention}
                    isArgumentsStreaming={isArgumentsStreaming}
                    isToolCalling={isToolCalling}
                    messageId={assistantMessageId}
                    result={result}
                    showCustomToolRender={showCustomToolRender}
                    toolCallId={id}
                    toolMessageId={toolMessageId}
                    type={type}
                  />
                </SafeBoundary>
                <Divider dashed style={{ marginBottom: 0, marginTop: 8 }} />
              </Flexbox>
            ),
            key: id,
            title: (
              <Inspectors
                apiName={apiName}
                arguments={requestArgs}
                identifier={identifier}
                intervention={intervention}
                isArgumentsStreaming={isArgumentsStreaming}
                isExpanded={isToolDetailExpand}
                isToolCalling={isToolCalling}
                messageId={assistantMessageId}
                pluginMeta={pluginMeta}
                result={result}
                toolCallId={id}
                toolCallStartTime={toolCallStartTime}
              />
            ),
          },
        ]}
        onValueChange={(value) => handleExpand(value.includes(id))}
      />
    );
  },
);

Tool.displayName = 'GroupTool';

export default Tool;
