import { createStaticStyles, Flexbox } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo, useCallback, useMemo } from 'react';

import type { ChatStoreState } from '@/store/chat';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/slices/operation/selectors';
import { useToolStore } from '@/store/tool';
import { toolSelectors } from '@/store/tool/selectors';

import { dataSelectors, useConversationStore } from '../../store';
import { resolveExecutingToolCallIds } from './activeToolCall';
import Tool from './Tool';
import { shouldRenderToolCall } from './toolRenderRules';

const styles = createStaticStyles(({ css }) => ({
  row: css`
    /* Long turns mount dozens of rows inside a height-capped scroll area.
       Skip style/layout/paint for the ones scrolled out of view instead of
       keeping every row live. */
    content-visibility: auto;
    contain-intrinsic-size: auto 32px;
  `,
}));

interface ToolsRendererProps {
  disableEditing?: boolean;
  messageId: string;
  toolIds?: string[];
}

export const Tools = memo<ToolsRendererProps>(({ disableEditing, messageId, toolIds }) => {
  const tools = useConversationStore((s) => dataSelectors.getToolsInBlock(messageId)(s), isEqual);

  // Subscribe only to the visible tool ids of this block. Streaming chunks that
  // change a single tool's args/result do not invalidate this string array, so
  // sibling Tool components stay isolated and only the changed one re-renders.
  const visibleToolCallIds = useMemo(
    () =>
      tools
        ? tools
            .filter((t) => shouldRenderToolCall(t) && (!toolIds || toolIds.includes(t.id)))
            .map((t) => t.id)
        : [],
    [tools, toolIds],
  );

  // The operation flags are per message, not per tool call: one running
  // `toolCalling` operation covers the whole block. Read them here once so the
  // N rows share one subscription instead of each resolving its own executing
  // state, and hand each row the answer instead.
  const isBlockBusy = useChatStore(operationSelectors.isMessageProcessing(messageId));
  const isBlockToolCalling = useChatStore(operationSelectors.isMessageInToolCalling(messageId));

  // A batch can run its calls concurrently, so the block alone cannot say which
  // rows are running: ask the operations for each call's own start time. One
  // subscription for the whole block returns `undefined` until every call is
  // resolved, which keeps the previous answer on screen instead of blinking the
  // spinners out for a frame.
  const selectRunningStartTimes = useCallback(
    (s: ChatStoreState) => {
      const startTimes = visibleToolCallIds.map((toolCallId) =>
        operationSelectors.getRunningToolCallStartTime(toolCallId)(s),
      );
      return startTimes.includes(undefined) ? undefined : startTimes;
    },
    [visibleToolCallIds],
  );
  const runningStartTimes = useChatStore(selectRunningStartTimes, isEqual);
  const runningToolCallIds = useMemo(
    () =>
      runningStartTimes
        ? new Set(visibleToolCallIds.filter((_, index) => runningStartTimes[index] !== undefined))
        : undefined,
    [runningStartTimes, visibleToolCallIds],
  );

  const executingToolCallIds = resolveExecutingToolCallIds(
    tools,
    isBlockToolCalling || isBlockBusy,
    runningToolCallIds,
  );

  // One scan of the tool list for every identifier in this block. Resolving
  // each row's metadata on its own rebuilt and walked the builtin + plugin +
  // skill list once per row.
  const identifierByToolCallId = useMemo(
    () => new Map(tools?.map((t) => [t.id, t.identifier]) ?? []),
    [tools],
  );
  const identifiers = useMemo(
    () => [...new Set(identifierByToolCallId.values())].filter(Boolean),
    [identifierByToolCallId],
  );
  const pluginMetaByIdentifier = useToolStore(
    toolSelectors.getMetaByIdentifiers(identifiers),
    isEqual,
  );

  if (visibleToolCallIds.length === 0) return null;

  return (
    <Flexbox gap={8}>
      {visibleToolCallIds.map((toolCallId) => (
        <Flexbox className={styles.row} key={toolCallId}>
          <Tool
            assistantMessageId={messageId}
            disableEditing={disableEditing}
            id={toolCallId}
            isExecuting={executingToolCallIds.includes(toolCallId)}
            pluginMeta={pluginMetaByIdentifier[identifierByToolCallId.get(toolCallId) ?? '']}
          />
        </Flexbox>
      ))}
    </Flexbox>
  );
});
