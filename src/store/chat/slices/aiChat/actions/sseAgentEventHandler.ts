import type { ConversationContext } from '@lobechat/types';
import { AgentRuntimeErrorType } from '@lobechat/types';

import { messageService } from '@/services/message';
import type { StreamEvent } from '@/services/agentRuntime/type';
import { emitClientAgentSignalSourceEvent } from '@/store/chat/slices/aiChat/actions/agentSignalBridge';
import type { ChatStore } from '@/store/chat/store';
import { notifyDesktopHumanApprovalRequired } from '@/store/chat/utils/desktopNotification';

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
          // Read new assistant message ID from stream_start (created by server for this step)
          const data = event.data as { assistantMessage?: { id: string } } | undefined;
          const newAssistantMessageId = data?.assistantMessage?.id;
          if (newAssistantMessageId) {
            currentAssistantMessageId = newAssistantMessageId;
            get().associateMessageWithOperation(currentAssistantMessageId, operationId);
          }

          accumulatedContent = '';
          accumulatedReasoning = '';
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

          // Handle text content – update raw messages through the reducer (same as Gateway handler)
          if (data.chunkType === 'text' && data.content) {
            accumulatedContent += data.content;
            get().internal_dispatchMessage(
              {
                id: currentAssistantMessageId,
                type: 'updateMessage',
                value: { content: accumulatedContent },
              },
              dispatchContext,
            );
          }

          // Handle reasoning content
          if (data.chunkType === 'reasoning' && data.reasoning) {
            accumulatedReasoning += data.reasoning;
            get().internal_dispatchMessage(
              {
                id: currentAssistantMessageId,
                type: 'updateMessage',
                value: { reasoning: { content: accumulatedReasoning } },
              },
              dispatchContext,
            );
          }

          // Handle tools_calling
          if (data.chunkType === 'tools_calling' && data.toolsCalling) {
            get().internal_dispatchMessage(
              {
                id: currentAssistantMessageId,
                type: 'updateMessage',
                value: { tools: data.toolsCalling },
              },
              dispatchContext,
            );

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

          // completeOperation + topic loading cleanup are delegated to onComplete
          // (mirrors gateway's onSessionComplete — see executeServerSseAgent).

          const completedOp = get().operations[operationId];
          if (completedOp?.context.agentId) {
            get().markUnreadCompleted(completedOp.context.agentId, completedOp.context.topicId);
          }

          // onComplete handles: completeOperation, internal_updateTopicLoading(false),
          // clear runningOperation metadata, and caller's onComplete callback.
          if (onComplete) {
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
