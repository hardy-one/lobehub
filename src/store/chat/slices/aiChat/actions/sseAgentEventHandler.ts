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
 * Update display messages directly without triggering parse().
 * Used during SSE streaming to update content without recreating assistantGroup.
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
  const index = displayMessages.findIndex((m: UIChatMessage) => m.id === messageId);
  if (index < 0) return;

  // Find the message in displayMessages and update it directly
  const message = displayMessages[index];
  if (!message) return;

  // For assistantGroup, find the last child block and update its content
  if (message.role === 'assistantGroup' && message.children && message.children.length > 0) {
    const lastChild = message.children[message.children.length - 1];
    if (lastChild) {
      if (updates.content !== undefined) {
        lastChild.content = updates.content;
      }
      if (updates.reasoning !== undefined) {
        lastChild.reasoning = updates.reasoning;
      }
      if (updates.tools !== undefined) {
        lastChild.tools = updates.tools;
      }
    }
    return;
  }

  // For regular assistant message, update directly
  if (message.role === 'assistant') {
    if (updates.content !== undefined) {
      (message as any).content = updates.content;
    }
    if (updates.reasoning !== undefined) {
      (message as any).reasoning = updates.reasoning;
    }
    if (updates.tools !== undefined) {
      (message as any).tools = updates.tools;
    }
  }
};

export const createSSEAgentEventHandler = (
  get: () => ChatStore,
  params: {
    assistantMessageId: string;
    context: ConversationContext;
    operationId: string;
    terminalFlag?: { reached: boolean };
  },
) => {
  const { context, operationId, terminalFlag } = params;
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
          get().completeOperation(operationId);

          const completedOp = get().operations[operationId];
          if (completedOp?.context.agentId) {
            get().markUnreadCompleted(completedOp.context.agentId, completedOp.context.topicId);
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
          get().completeOperation(operationId);

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
