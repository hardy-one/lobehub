import type { ConversationContext, UIChatMessage } from '@lobechat/types';
import { AgentRuntimeErrorType } from '@lobechat/types';

import { messageService } from '@/services/message';
import type { StreamEvent } from '@/services/agentRuntime/type';
import { emitClientAgentSignalSourceEvent } from '@/store/chat/slices/aiChat/actions/agentSignalBridge';
import type { ChatStore } from '@/store/chat/store';
import { notifyDesktopHumanApprovalRequired } from '@/store/chat/utils/desktopNotification';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

interface StreamChunkData {
  chunkType?: string;
  content?: string;
  reasoning?: string;
  toolsCalling?: any[];
  toolMessageIds?: Record<string, unknown>;
}

export interface SSEEventHandlerState {
  /** Latest event timestamp for reconnect lastEventId */
  lastEventId: string;
  /** Server requested reconnect via stream_retry event */
  reconnectRequested: boolean;
}

const fetchAndReplaceMessages = async (get: () => ChatStore, context: ConversationContext) => {
  const messages = await messageService.getMessages(context);
  get().replaceMessages(messages, { context });
};

const toChatMessageError = (data: unknown) => {
  if (typeof data === 'object' && data && 'type' in data && typeof data.type === 'string') {
    const error = data as any;
    return {
      ...error,
      message: error.message || error.body?.message,
    };
  }

  const message =
    typeof data === 'object' && data && 'message' in data && typeof data.message === 'string'
      ? data.message
      : typeof data === 'object' && data && 'error' in data && typeof data.error === 'string'
        ? data.error
        : 'Unknown error';

  return {
    body: { message },
    message,
    type: AgentRuntimeErrorType.AgentRuntimeError,
  };
};

/**
 * Apply content updates to a message by creating a NEW object (not in-place mutation).
 * This is critical because ConversationProvider uses memo(..., isEqual) which short-circuits
 * on same-reference objects — in-place updates are invisible to the sync bridge.
 */
const applyUpdates = (
  msg: any,
  updates: Partial<{ content: string; reasoning: { content: string }; tools: any[] }>,
): any => {
  let updated = msg;
  if (updates.content !== undefined) {
    updated = { ...updated, content: updates.content };
  }
  if (updates.reasoning !== undefined) {
    updated = { ...updated, reasoning: updates.reasoning };
  }
  if (updates.tools !== undefined) {
    updated = { ...updated, tools: updates.tools };
  }
  return updated;
};

/**
 * Update display messages directly without triggering parse().
 * Used during SSE streaming to update content without recreating assistantGroup.
 *
 * Also updates the corresponding raw message in dbMessagesMap and triggers
 * a Zustand set() via internal_refreshMessageMaps so the ChatStore ->
 * ConversationArea -> StoreUpdater -> ConversationStore bridge fires and
 * the UI re-renders with the updated content.
 */
const updateDisplayMessageContent = (
  get: () => ChatStore,
  messageId: string,
  context: ConversationContext,
  updates: Partial<{ content: string; reasoning: { content: string }; tools: any[] }>,
) => {
  const key = messageMapKey({
    agentId: context.agentId,
    groupId: context.groupId,
    threadId: context.threadId,
    topicId: context.topicId,
  });
  const displayMessages = get().messagesMap[key] || [];
  const rawMessages = get().dbMessagesMap[key] || [];
  let mutated = false;

  // Create mutable copies of the arrays so we can replace objects
  const newDisplayMessages = [...displayMessages];
  const newRawMessages = [...rawMessages];

  const index = newDisplayMessages.findIndex((m: UIChatMessage) => m.id === messageId);
  if (index < 0) {
    // The message might be inside an assistantGroup's children rather than at
    // the top level of the flatList. Search recursively.
    for (let di = 0; di < newDisplayMessages.length; di++) {
      const displayMsg = newDisplayMessages[di];
      if (displayMsg.role === 'assistantGroup' && displayMsg.children) {
        const childIndex = displayMsg.children.findIndex((c: any) => c.id === messageId);
        if (childIndex >= 0 && displayMsg.children[childIndex]) {
          const child = displayMsg.children[childIndex];
          const newChild = applyUpdates(child, updates);

          // Create new children array and new group message
          const newChildren = [...displayMsg.children];
          newChildren[childIndex] = newChild;
          newDisplayMessages[di] = { ...displayMsg, children: newChildren };

          // Also update the raw message — in dbMessagesMap this child is a
          // standalone 'assistant' message, not nested inside a group.
          const rawIndex = newRawMessages.findIndex((m: any) => m.id === messageId);
          if (rawIndex >= 0) {
            newRawMessages[rawIndex] = applyUpdates(newRawMessages[rawIndex], updates);
          }

          mutated = true;
          break;
        }
      }
    }
    if (!mutated) {
      console.log(
        `[SSE-Agent] updateDisplayMessageContent: message ${messageId} not found in messagesMap[${key}] ` +
        `(topLevel=${displayMessages.length}, searched inside assistantGroup children too)`,
      );
      return;
    }
  } else {
    // Find the message in displayMessages and update it directly
    const message = newDisplayMessages[index];
    if (!message) return;

    const rawMsg = newRawMessages.find((m: any) => m.id === messageId);

    // For assistantGroup, find the last child block and update its content
    if (message.role === 'assistantGroup' && message.children && message.children.length > 0) {
      const lastIndex = message.children.length - 1;
      const newLastChild = applyUpdates(message.children[lastIndex], updates);

      // Create new children array and new group message
      const newChildren = [...message.children];
      newChildren[lastIndex] = newLastChild;
      newDisplayMessages[index] = { ...message, children: newChildren };

      // Mirror on raw message — in dbMessagesMap it's a plain 'assistant'
      if (rawMsg?.role === 'assistant') {
        const rawIndex = newRawMessages.findIndex((m: any) => m.id === messageId);
        if (rawIndex >= 0) {
          newRawMessages[rawIndex] = applyUpdates(rawMsg, updates);
        }
      }

      mutated = true;
    }

    // For regular assistant message, update directly
    if (message.role === 'assistant') {
      newDisplayMessages[index] = applyUpdates(message, updates);

      // Mirror on raw message
      if (rawMsg?.role === 'assistant') {
        const rawIndex = newRawMessages.findIndex((m: any) => m.id === messageId);
        if (rawIndex >= 0) {
          newRawMessages[rawIndex] = applyUpdates(rawMsg, updates);
        }
      }

      mutated = true;
    }
  }

  // Trigger the ChatStore -> ConversationStore sync bridge so the UI re-renders
  if (mutated) {
    console.log(
      `[SSE-Agent] updateDisplayMessageContent: content updated for ${messageId}, triggering refresh`,
    );
    // Pass the pre-built arrays with new object references directly so that
    // downstream memo(isEqual) checks (ConversationProvider) see new reference
    // chains and re-render. Without new objects, fast-deep-equal short-circuits
    // on same-reference objects and the sync bridge never fires.
    get().internal_refreshMessageMaps(key, newDisplayMessages, newRawMessages);
  }
};

export const createSSEAgentEventHandler = (
  get: () => ChatStore,
  params: {
    assistantMessageId: string;
    context: ConversationContext;
    operationId: string;
    terminalFlag?: { reached: boolean };
    /** Called when the agent runtime terminates (normal completion or error).
     *  Equivalent to gateway's onSessionComplete. Required for SSE mode since
     *  there is no WebSocket session lifecycle to trigger cleanup. */
    onComplete?: () => void;
  },
) => {
  const { context, onComplete, operationId, terminalFlag } = params;
  const dispatchContext = { operationId };

  let currentAssistantMessageId = params.assistantMessageId;
  let terminalState: 'completed' | 'error' | undefined;

  let accumulatedContent = '';
  let accumulatedReasoning = '';
  /** Track if we've received tools_calling - once true, content updates go to children */
  let hasTools = false;

  let processingChain: Promise<void> = Promise.resolve();

  const enqueue = (fn: () => Promise<void> | void): void => {
    processingChain = processingChain.then(fn, fn);
  };

  // Track state for reconnect scenarios
  const state: SSEEventHandlerState = {
    lastEventId: '0',
    reconnectRequested: false,
  };

  return {
    handler: (event: StreamEvent) => {
      if (terminalState) return;

      // Update lastEventId for reconnect (use timestamp as event ID)
      if (event.timestamp && event.timestamp.toString() > state.lastEventId) {
        state.lastEventId = event.timestamp.toString();
      }

      console.log(`[SSE-Agent] Received event: type=${event.type}, stepIndex=${event.stepIndex ?? 'N/A'}, lastEventId=${state.lastEventId}`);

      if (event.type === 'agent_runtime_end' || event.type === 'error') {
        terminalState = event.type === 'error' ? 'error' : 'completed';
        if (terminalFlag) terminalFlag.reached = true;
        console.log(`[SSE-Agent] Terminal state: ${terminalState}`);
      }

      switch (event.type) {
      case 'agent_runtime_init':
      case 'stream_start': {
        enqueue(async () => {
          accumulatedContent = '';
          accumulatedReasoning = '';
          hasTools = false;
          void emitClientAgentSignalSourceEvent({
            payload: {
              agentId: context.agentId,
              operationId,
              stepIndex: event.stepIndex ?? 0,
              topicId: context.topicId ?? undefined,
            },
            sourceId: `${operationId}:sse:start:${event.stepIndex}`,
            sourceType: 'client.gateway.stream_start',
          });
          await fetchAndReplaceMessages(get, context).catch(console.error);
        });
        break;
      }

      case 'stream_chunk': {
        enqueue(() => {
          const data = event.data as StreamChunkData | undefined;
          if (!data) return;

          // Handle text content - update display directly to avoid parse() recreating assistantGroup
          if (data.chunkType === 'text' && data.content) {
            accumulatedContent += data.content;
            // Once tools are present, content belongs to the last child block
            // Update display directly without triggering parse()
            updateDisplayMessageContent(get, currentAssistantMessageId, context, { content: accumulatedContent });
          }

          // Handle reasoning content
          if (data.chunkType === 'reasoning' && data.reasoning) {
            accumulatedReasoning += data.reasoning;
            updateDisplayMessageContent(get, currentAssistantMessageId, context, { reasoning: { content: accumulatedReasoning } });
          }

          // Handle tools_calling - mark that we have tools
          if (data.chunkType === 'tools_calling' && data.toolsCalling) {
            hasTools = true;
            updateDisplayMessageContent(get, currentAssistantMessageId, context, { tools: data.toolsCalling });

            get().internal_toggleToolCallingStreaming(
              currentAssistantMessageId,
              data.toolsCalling.map(() => true),
            );

            // Only fetch from server when tool messages are created
            // This refreshes the message structure but content updates continue locally
            if ((data as any).toolMessageIds) {
              fetchAndReplaceMessages(get, context).catch(console.error);
            }
          }
        });
        break;
      }

      case 'stream_end': {
        enqueue(() => {
          get().internal_toggleToolCallingStreaming(currentAssistantMessageId, undefined);
        });
        break;
      }

      case 'stream_retry': {
        console.log(
          `[SSE-Agent] Server requested reconnect for operation ${operationId}, ` +
          `stepIndex=${event.stepIndex ?? 'N/A'}, lastEventId=${state.lastEventId}`,
        );
        state.reconnectRequested = true;
        break;
      }

      case 'tool_start': {
        console.log(`[SSE-Agent] Tool start: stepIndex=${event.stepIndex ?? 'N/A'}`);
        break;
      }

      case 'step_start': {
        const stepData = event.data as {
          pendingToolsCalling?: unknown[];
          phase?: string;
          requiresApproval?: boolean;
        };
        console.log(
          `[SSE-Agent] Step start: stepIndex=${event.stepIndex ?? 'N/A'}, ` +
          `phase=${stepData.phase ?? 'unknown'}`,
        );
        if (stepData.phase === 'human_approval' && stepData.requiresApproval && stepData.pendingToolsCalling) {
          void notifyDesktopHumanApprovalRequired(get, context);
        }
        break;
      }

      case 'tool_end': {
        enqueue(async () => {
          await fetchAndReplaceMessages(get, context).catch(console.error);
        });
        break;
      }

      case 'step_complete': {
        enqueue(async () => {
          void emitClientAgentSignalSourceEvent({
            payload: {
              agentId: context.agentId,
              operationId,
              stepIndex: event.stepIndex ?? 0,
              topicId: context.topicId ?? undefined,
            },
            sourceId: `${operationId}:sse:step_complete:${event.stepIndex}`,
            sourceType: 'client.gateway.step_complete',
          });
          await fetchAndReplaceMessages(get, context).catch(console.error);
        });
        break;
      }

      case 'agent_runtime_end': {
        enqueue(async () => {
          console.log(
            `[SSE-Agent] agent_runtime_end — operation=${operationId}, topicId=${context.topicId ?? 'none'}, ` +
            `assistantMessageId=${currentAssistantMessageId}`,
          );
          void emitClientAgentSignalSourceEvent({
            payload: {
              agentId: context.agentId,
              ...(currentAssistantMessageId ? { assistantMessageId: currentAssistantMessageId } : {}),
              operationId,
              topicId: context.topicId ?? undefined,
            },
            sourceId: `${operationId}:sse:runtime_end`,
            sourceType: 'client.gateway.runtime_end',
          });
          get().internal_toggleToolCallingStreaming(currentAssistantMessageId, undefined);

          // completeOperation + topic loading cleanup are delegated to onComplete
          // (mirrors gateway's onSessionComplete — see executeServerSseAgent).

          const completedOp = get().operations[operationId];
          if (completedOp?.context.agentId) {
            get().markUnreadCompleted(completedOp.context.agentId, completedOp.context.topicId);
          }

          // onComplete handles: completeOperation, internal_updateTopicLoading(false),
          // clear runningOperation metadata, and caller's onComplete callback.
          if (onComplete) {
            console.log(`[SSE-Agent] Calling onComplete callback`);
            onComplete();
          }

          // Final sync with server - this creates the proper assistantGroup structure
          await fetchAndReplaceMessages(get, context).catch(console.error);
        });
        break;
      }

      case 'error': {
        enqueue(async () => {
          const messageError = toChatMessageError(event.data);
          const errorMessage = messageError.message;

          console.log(
            `[SSE-Agent] error — operation=${operationId}, topicId=${context.topicId ?? 'none'}, ` +
            `message=${errorMessage}`,
          );

          void emitClientAgentSignalSourceEvent({
            payload: {
              agentId: context.agentId,
              errorMessage,
              operationId,
              topicId: context.topicId ?? undefined,
            },
            sourceId: `${operationId}:sse:error`,
            sourceType: 'client.gateway.error',
          });

          get().internal_toggleToolCallingStreaming(currentAssistantMessageId, undefined);

          // completeOperation + topic loading cleanup are delegated to onComplete
          // (mirrors gateway's onSessionComplete — see executeServerSseAgent).

          // onComplete handles: completeOperation, internal_updateTopicLoading(false),
          // clear runningOperation metadata, and caller's onComplete callback.
          if (onComplete) {
            console.log(`[SSE-Agent] Calling onComplete callback (error path)`);
            onComplete();
          }

          const updateResult = await messageService
            .updateMessageError(currentAssistantMessageId, messageError, {
              agentId: context.agentId,
              groupId: context.groupId,
              threadId: context.threadId,
              topicId: context.topicId,
            })
            .catch(console.error);

          if (updateResult?.success && updateResult.messages) {
            get().replaceMessages(updateResult.messages, { context });
          } else {
            await fetchAndReplaceMessages(get, context).catch(console.error);
          }

          get().internal_dispatchMessage(
            {
              id: currentAssistantMessageId,
              type: 'updateMessage',
              value: { error: messageError },
            },
            dispatchContext,
          );
        });
        break;
      }

      case 'connected':
      case 'heartbeat':
        break;
    }
  },
    state,
  };
};
