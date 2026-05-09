// Disable the auto sort key eslint rule to make the code more logic and readable
import { type AgentRuntimeContext } from '@lobechat/agent-runtime';
import { MESSAGE_CANCEL_FLAT } from '@lobechat/const';
import { type ConversationContext } from '@lobechat/types';

import { getAgentStoreState } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { selectRuntimeType } from '@/store/chat/slices/aiChat/actions/agentDispatcher';
import { operationSelectors } from '@/store/chat/slices/operation/selectors';
import { AI_RUNTIME_OPERATION_TYPES } from '@/store/chat/slices/operation/types';
import { type ChatStore } from '@/store/chat/store';
import { type StoreSetter } from '@/store/types';

import { displayMessageSelectors } from '../../../selectors';
import { messageMapKey } from '../../../utils/messageMapKey';
import { type OptimisticUpdateContext } from '../../message/actions/optimisticUpdate';
import { dbMessageSelectors } from '../../message/selectors';

/**
 * Actions for controlling conversation operations like cancellation and error handling
 */

type Setter = StoreSetter<ChatStore>;
export const conversationControl = (set: Setter, get: () => ChatStore, _api?: unknown) =>
  new ConversationControlActionImpl(set, get, _api);

export class ConversationControlActionImpl {
  readonly #get: () => ChatStore;

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    void set;
    this.#get = get;
  }

  /**
   * Decide whether approve/reject/reject_continue should go through the
   * server-mode resume path (new op carrying `resumeApproval`) instead of the
   * local `executeClientAgent` path. Mirrors the "interrupt + new op"
   * pattern from LOBE-7142.
   *
   * Returns true for both Gateway WebSocket and self-hosted SSE modes.
   * Actual dispatch to the correct runtime happens in `#dispatchServerResume`.
   * Hetero resume is not yet implemented and falls through to client local
   * resume — see LOBE-8519.
   *
   * We deliberately do **not** look for a living `execServerAgentRuntime`
   * op here. The server's `waiting_for_human` → `agent_runtime_end` signal
   * marks the paused op `completed` client-side, and `startOperation` runs
   * `cleanupCompletedOperations(30_000)` on every new op, which means the
   * paused op is typically gone by the time the user clicks approve — so
   * scanning for it would flip us back into client-mode against a live
   * Gateway backend.
   */
  #shouldUseGatewayResume = (context: ConversationContext): boolean => {
    const agentConfig = context.agentId
      ? agentSelectors.getAgentConfigById(context.agentId)(getAgentStoreState())
      : undefined;
    const rt = selectRuntimeType({
      heterogeneousProvider: agentConfig?.agencyConfig?.heterogeneousProvider,
      isGatewayMode: this.#get().isGatewayModeEnabled(),
      isServerSseMode: this.#get().isServerSseEnabled(),
    });
    return rt === 'gateway' || rt === 'serverSse';
  };

  /**
   * Return running (non-aborting) `execServerAgentRuntime` ops in the given
   * context. Used only to snapshot paused ops before starting a resume op
   * so we can retire them if the server-side `agent_runtime_end` signal is
   * delayed or missing — see `#completeOpsById`. In steady state with the
   * coordinator fix active, this returns an empty list by the time approve
   * runs because the server already completed the op.
   */
  #getRunningServerOps = (context: ConversationContext) => {
    const { agentId, groupId, scope, subAgentId, topicId, threadId } = context;
    if (!agentId) return [];
    const ops = operationSelectors.getOperationsByContext({
      agentId,
      groupId,
      scope,
      subAgentId,
      threadId: threadId ?? null,
      topicId: topicId ?? null,
    })(this.#get());
    return ops.filter(
      (op) =>
        op.type === 'execServerAgentRuntime' && op.status === 'running' && !op.metadata?.isAborting,
    );
  };

  /**
   * Client-side fallback guard that retires paused server ops once a Gateway
   * resume op has started successfully. The server emits `agent_runtime_end`
   * after `human_approve_required`, but if that event is delayed or the
   * backend lacks the fix the paused op would linger as "running" and keep
   * the loading spinner on. Callers must snapshot the IDs *before*
   * `executeGatewayAgent` and only invoke this helper after the resume call
   * resolves — completing eagerly on failure would erase the running marker
   * while the server is still paused, causing retries to miss the Gateway
   * branch and fall through to client-mode.
   */
  #completeOpsById = (opIds: readonly string[]): void => {
    const { completeOperation } = this.#get();
    for (const id of opIds) completeOperation(id);
  };

  /**
   * Dispatch a server-mode resume (approve/reject/continue) to the correct
   * runtime — Gateway WebSocket or self-hosted SSE. Selects the runtime the
   * same way sendMessageInternal does, so the resume path stays consistent
   * with how the original operation was dispatched.
   */
  #dispatchServerResume = async (
    effectiveContext: ConversationContext,
    params: {
      decision: 'approved' | 'rejected_continue';
      parentMessageId: string;
      toolCallId: string;
      rejectionReason?: string;
    },
  ): Promise<void> => {
    const agentConfig = effectiveContext.agentId
      ? agentSelectors.getAgentConfigById(effectiveContext.agentId)(getAgentStoreState())
      : undefined;
    const rt = selectRuntimeType({
      heterogeneousProvider: agentConfig?.agencyConfig?.heterogeneousProvider,
      isGatewayMode: this.#get().isGatewayModeEnabled(),
      isServerSseMode: this.#get().isServerSseEnabled(),
    });

    const resumeApproval = {
      decision: params.decision,
      parentMessageId: params.parentMessageId,
      toolCallId: params.toolCallId,
      ...(params.rejectionReason !== undefined && { rejectionReason: params.rejectionReason }),
    };

    if (rt === 'gateway') {
      await this.#get().executeGatewayAgent({
        context: effectiveContext,
        message: '',
        parentMessageId: params.parentMessageId,
        resumeApproval,
      });
    } else if (rt === 'serverSse') {
      await this.#get().executeServerSseAgent({
        context: effectiveContext,
        message: '',
        parentMessageId: params.parentMessageId,
        resumeApproval,
      });
    } else {
      console.warn(
        `[dispatchServerResume] Unexpected runtime type: ${rt}, no resume dispatched`,
      );
    }
  };

  stopGenerateMessage = (): void => {
    const { activeAgentId, activeTopicId, cancelOperations } = this.#get();

    // Cancel running agent-runtime operations in the current context —
    // client-side (execAgentRuntime), heterogeneous agent (execHeterogeneousAgent),
    // and Gateway-mode (execServerAgentRuntime).
    cancelOperations(
      {
        type: AI_RUNTIME_OPERATION_TYPES,
        status: 'running',
        agentId: activeAgentId,
        topicId: activeTopicId,
      },
      MESSAGE_CANCEL_FLAT,
    );
  };

  cancelSendMessageInServer = (topicId?: string): void => {
    const { activeAgentId, activeTopicId } = this.#get();

    // Determine which operation to cancel
    const targetTopicId = topicId ?? activeTopicId;
    const contextKey = messageMapKey({ agentId: activeAgentId, topicId: targetTopicId });

    // Cancel operations in the operation system
    const operationIds = this.#get().operationsByContext[contextKey] || [];

    operationIds.forEach((opId) => {
      const operation = this.#get().operations[opId];
      if (operation && operation.type === 'sendMessage' && operation.status === 'running') {
        this.#get().cancelOperation(opId, 'User cancelled');
      }
    });

    // Restore editor state if it's the active session
    if (contextKey === messageMapKey({ agentId: activeAgentId, topicId: activeTopicId })) {
      // Find the latest sendMessage operation with editor state
      for (const opId of [...operationIds].reverse()) {
        const op = this.#get().operations[opId];
        if (op && op.type === 'sendMessage' && op.metadata.inputEditorTempState) {
          this.#get().mainInputEditor?.setJSONState(op.metadata.inputEditorTempState);
          break;
        }
      }
    }
  };

  clearSendMessageError = (): void => {
    const { activeAgentId, activeTopicId } = this.#get();
    const contextKey = messageMapKey({ agentId: activeAgentId, topicId: activeTopicId });
    const operationIds = this.#get().operationsByContext[contextKey] || [];

    // Clear error message from all sendMessage operations in current context
    operationIds.forEach((opId) => {
      const op = this.#get().operations[opId];
      if (op && op.type === 'sendMessage' && op.metadata.inputSendErrorMsg) {
        this.#get().updateOperationMetadata(opId, { inputSendErrorMsg: undefined });
      }
    });
  };

  switchMessageBranch = async (
    messageId: string,
    branchIndex: number,
    context?: OptimisticUpdateContext,
  ): Promise<void> => {
    await this.#get().optimisticUpdateMessageMetadata(
      messageId,
      { activeBranchIndex: branchIndex },
      context,
    );

    // Reset descendant branch points along the newly-active path.
    // When switching a branch, any child branch points should reset to
    // their first branch so the UI shows a consistent path.
    const message = dbMessageSelectors.getDbMessageById(messageId)(this.#get());
    if (!message) return;

    const store = this.#get();
    const contextKey = message.parentId
      ? (() => {
          // Find the context key for the message's topic
          const keys = Object.keys(store.dbMessagesMap);
          return keys.find((k) => store.dbMessagesMap[k]?.some((m) => m.id === messageId)) || keys[0];
        })()
      : undefined;
    const dbMessages = contextKey ? store.dbMessagesMap[contextKey] || [] : store.dbMessagesMap[Object.keys(store.dbMessagesMap)[0]] || [];

    // Build children map: parentId -> list of children sorted by createdAt
    const childrenMap = new Map<string, string[]>();
    for (const msg of dbMessages) {
      if (msg.parentId) {
        const siblings = childrenMap.get(msg.parentId) || [];
        siblings.push(msg.id);
        childrenMap.set(msg.parentId, siblings);
      }
    }
    // Sort by createdAt (already stored as string/number on messages)
    for (const [parentId, childIds] of childrenMap) {
      childIds.sort((a, b) => {
        const msgA = dbMessages.find((m) => m.id === a);
        const msgB = dbMessages.find((m) => m.id === b);
        return (msgA?.createdAt ?? 0) - (msgB?.createdAt ?? 0);
      });
      childrenMap.set(parentId, childIds);
    }

    // Walk down from the selected message, reset branch points to first branch
    const descendantUpdates: Promise<void>[] = [];
    let currentId: string | undefined = messageId;

    while (currentId) {
      const childIds = childrenMap.get(currentId);
      if (!childIds || childIds.length === 0) break;

      if (childIds.length > 1) {
        // This message is a branch point — reset to first branch
        descendantUpdates.push(
          this.#get().optimisticUpdateMessageMetadata(
            currentId,
            { activeBranchIndex: 0 },
            context,
          ),
        );
      }

      // Follow the first child
      currentId = childIds[0];
    }

    await Promise.all(descendantUpdates);
  };

  approveToolCalling = async (
    toolMessageId: string,
    _assistantGroupId: string,
    context?: ConversationContext,
  ): Promise<void> => {
    const { executeClientAgent, startOperation, completeOperation } = this.#get();

    // Build effective context from provided context or global state
    const effectiveContext: ConversationContext = context ?? {
      agentId: this.#get().activeAgentId,
      topicId: this.#get().activeTopicId,
      threadId: this.#get().activeThreadId,
    };

    const { agentId, topicId, threadId, scope } = effectiveContext;

    // 1. Get tool message and verify it exists
    const toolMessage = dbMessageSelectors.getDbMessageById(toolMessageId)(this.#get());
    if (!toolMessage) return;

    // Create an operation to carry the context for optimistic updates
    // This ensures optimistic updates use the correct agentId/topicId
    const { operationId } = startOperation({
      type: 'approveToolCalling',
      context: {
        agentId,
        topicId: topicId ?? undefined,
        threadId: threadId ?? undefined,
        scope,
        messageId: toolMessageId,
      },
    });

    const optimisticContext = { operationId };

    // 2. Update intervention status to approved
    await this.#get().optimisticUpdateMessagePlugin(
      toolMessageId,
      { intervention: { status: 'approved' } },
      optimisticContext,
    );

    // 2.5. Server-mode: start a **new** Gateway/SSE op carrying the approval
    // decision via `resumeApproval`. Routes via `#dispatchServerResume` to
    // the correct runtime (Gateway WebSocket or self-hosted SSE). The server
    // reads the target tool message, persists `intervention=approved`,
    // dispatches the approved tool, and streams results back on the new op.
    // No in-place resume of the paused op — simpler state + avoids stepIndex
    // races.
    if (this.#shouldUseGatewayResume(effectiveContext)) {
      const toolCallId = toolMessage.tool_call_id;
      if (!toolCallId) {
        console.warn(
          '[approveToolCalling][server] tool message missing tool_call_id; skipping resume',
        );
        completeOperation(operationId);
        return;
      }
      // Snapshot paused op IDs before the resume call; retire them only
      // after #dispatchServerResume succeeds so a transient failure leaves
      // the running marker intact and `#shouldUseGatewayResume` still flags
      // server-mode on retry.
      const pausedOpIds = this.#getRunningServerOps(effectiveContext).map((op) => op.id);
      try {
        await this.#dispatchServerResume(effectiveContext, {
          decision: 'approved',
          parentMessageId: toolMessageId,
          toolCallId,
        });
        this.#completeOpsById(pausedOpIds);
        completeOperation(operationId);
      } catch (error) {
        const err = error as Error;
        console.error('[approveToolCalling][server] Resume failed:', err);
        this.#get().failOperation(operationId, {
          type: 'approveToolCalling',
          message: err.message || 'Unknown error',
        });
      }
      return;
    }

    // 3. Get current messages for state construction using context
    const chatKey = messageMapKey({ agentId, topicId, threadId, scope });
    const currentMessages = displayMessageSelectors.getDisplayMessagesByKey(chatKey)(this.#get());

    // 4. Create agent state and context with user intervention config
    const { state, context: initialContext } = this.#get().internal_createAgentState({
      messages: currentMessages,
      parentMessageId: toolMessageId,
      agentId,
      topicId,
      threadId: threadId ?? undefined,
      operationId,
    });

    // 5. Override context with 'human_approved_tool' phase
    const agentRuntimeContext: AgentRuntimeContext = {
      ...initialContext,
      phase: 'human_approved_tool',
      payload: {
        approvedToolCall: toolMessage.plugin,
        parentMessageId: toolMessageId,
        skipCreateToolMessage: true,
      },
    };

    // 7. Execute agent runtime from tool message position
    try {
      await executeClientAgent({
        context: effectiveContext,
        messages: currentMessages,
        parentMessageId: toolMessageId, // Start from tool message
        parentMessageType: 'tool', // Type is 'tool'
        initialState: state,
        initialContext: agentRuntimeContext,
        // Pass parent operation ID to establish parent-child relationship
        // This ensures proper cancellation propagation
        parentOperationId: operationId,
      });
      completeOperation(operationId);
    } catch (error) {
      const err = error as Error;
      console.error('[approveToolCalling] Error executing agent runtime:', err);
      this.#get().failOperation(operationId, {
        type: 'approveToolCalling',
        message: err.message || 'Unknown error',
      });
    }
  };

  submitToolInteraction = async (
    toolMessageId: string,
    response: Record<string, unknown>,
    context?: ConversationContext,
    options?: { createUserMessage?: boolean; toolResultContent?: string },
  ): Promise<void> => {
    const { executeClientAgent, startOperation, completeOperation } = this.#get();

    const effectiveContext: ConversationContext = context ?? {
      agentId: this.#get().activeAgentId,
      topicId: this.#get().activeTopicId,
      threadId: this.#get().activeThreadId,
    };

    const { agentId, topicId, threadId, scope } = effectiveContext;

    const toolMessage = dbMessageSelectors.getDbMessageById(toolMessageId)(this.#get());
    if (!toolMessage) return;

    const { operationId } = startOperation({
      type: 'submitToolInteraction',
      context: {
        agentId,
        topicId: topicId ?? undefined,
        threadId: threadId ?? undefined,
        scope,
        messageId: toolMessageId,
      },
    });

    const optimisticContext: OptimisticUpdateContext = { operationId };
    const shouldCreateUserMessage = options?.createUserMessage !== false;

    // 1. Mark intervention as approved and set tool result to user's response
    await this.#get().optimisticUpdateMessagePlugin(
      toolMessageId,
      { intervention: { status: 'approved' } },
      optimisticContext,
    );

    const toolContent = options?.toolResultContent ?? `User submitted: ${JSON.stringify(response)}`;
    await this.#get().optimisticUpdateMessageContent(
      toolMessageId,
      toolContent,
      undefined,
      optimisticContext,
    );

    const chatKey = messageMapKey({ agentId, topicId, threadId, scope });

    // 2a. Tool-result-only path: skip the synthetic user message and resume from the
    // tool message. Used by interventions whose UI handles its own side effect (e.g.
    // the agent marketplace picker forks agents directly) — the LLM should see the
    // tool result, not a fake user turn.
    if (!shouldCreateUserMessage) {
      const currentMessages = displayMessageSelectors.getDisplayMessagesByKey(chatKey)(this.#get());

      const { state, context: initialContext } = this.#get().internal_createAgentState({
        messages: currentMessages,
        parentMessageId: toolMessageId,
        agentId,
        topicId,
        threadId: threadId ?? undefined,
        operationId,
      });

      // Resume directly from `tool_result` phase rather than `human_approved_tool`.
      // The intervention UI already wrote the final tool result content via
      // `optimisticUpdateMessageContent`; routing through `human_approved_tool`
      // would re-execute the builtin tool on the server and overwrite our
      // content with the server-side placeholder (e.g. the marketplace picker
      // would clobber the picked-templates result with "picker is now visible").
      const agentRuntimeContext: AgentRuntimeContext = {
        ...initialContext,
        phase: 'tool_result',
        payload: {
          parentMessageId: toolMessageId,
        },
      };

      try {
        await executeClientAgent({
          context: effectiveContext,
          messages: currentMessages,
          parentMessageId: toolMessageId,
          parentMessageType: 'tool',
          initialState: state,
          initialContext: agentRuntimeContext,
          parentOperationId: operationId,
        });
        completeOperation(operationId);
      } catch (error) {
        const err = error as Error;
        console.error('[submitToolInteraction] Error executing agent runtime:', err);
        this.#get().failOperation(operationId, {
          type: 'submitToolInteraction',
          message: err.message || 'Unknown error',
        });
      }
      return;
    }

    // 2b. Default path: create a user message summarizing the response, resume from user
    const userMessageContent = Object.values(response).join(', ');
    const groupId = toolMessage.groupId;
    const userMsg = await this.#get().optimisticCreateMessage(
      {
        agentId: agentId!,
        content: userMessageContent,
        groupId: groupId ?? undefined,
        role: 'user',
        threadId: threadId ?? undefined,
        topicId: topicId ?? undefined,
      },
      optimisticContext,
    );

    if (!userMsg) {
      this.#get().failOperation(operationId, {
        type: 'submitToolInteraction',
        message: 'Failed to create user message',
      });
      return;
    }

    // 3. Resume agent from user message (not tool re-execution)
    const currentMessages = displayMessageSelectors.getDisplayMessagesByKey(chatKey)(this.#get());

    const { state, context: initialContext } = this.#get().internal_createAgentState({
      messages: currentMessages,
      parentMessageId: userMsg.id,
      agentId,
      topicId,
      threadId: threadId ?? undefined,
      operationId,
    });

    try {
      await executeClientAgent({
        context: effectiveContext,
        messages: currentMessages,
        parentMessageId: userMsg.id,
        parentMessageType: 'user',
        initialState: state,
        initialContext,
        parentOperationId: operationId,
      });
      completeOperation(operationId);
    } catch (error) {
      const err = error as Error;
      console.error('[submitToolInteraction] Error executing agent runtime:', err);
      this.#get().failOperation(operationId, {
        type: 'submitToolInteraction',
        message: err.message || 'Unknown error',
      });
    }
  };

  skipToolInteraction = async (
    toolMessageId: string,
    reason?: string,
    context?: ConversationContext,
  ): Promise<void> => {
    const { executeClientAgent, startOperation, completeOperation } = this.#get();

    const effectiveContext: ConversationContext = context ?? {
      agentId: this.#get().activeAgentId,
      topicId: this.#get().activeTopicId,
      threadId: this.#get().activeThreadId,
    };

    const { agentId, topicId, threadId, scope } = effectiveContext;

    const toolMessage = dbMessageSelectors.getDbMessageById(toolMessageId)(this.#get());
    if (!toolMessage) return;

    const { operationId } = startOperation({
      type: 'skipToolInteraction',
      context: {
        agentId,
        topicId: topicId ?? undefined,
        threadId: threadId ?? undefined,
        scope,
        messageId: toolMessageId,
      },
    });

    const optimisticContext: OptimisticUpdateContext = { operationId };

    // 1. Mark intervention as rejected (skipped) with reason
    await this.#get().optimisticUpdateMessagePlugin(
      toolMessageId,
      { intervention: { rejectedReason: reason, status: 'rejected' } },
      optimisticContext,
    );

    const toolContent = reason ? `User skipped: ${reason}` : 'User skipped this question.';
    await this.#get().optimisticUpdateMessageContent(
      toolMessageId,
      toolContent,
      undefined,
      optimisticContext,
    );

    // 2. Create a user message indicating the skip
    const userMessageContent = reason ? `I'll skip this. ${reason}` : "I'll skip this.";
    const groupId = toolMessage.groupId;
    const userMsg = await this.#get().optimisticCreateMessage(
      {
        agentId: agentId!,
        content: userMessageContent,
        groupId: groupId ?? undefined,
        role: 'user',
        threadId: threadId ?? undefined,
        topicId: topicId ?? undefined,
      },
      optimisticContext,
    );

    if (!userMsg) {
      this.#get().failOperation(operationId, {
        type: 'skipToolInteraction',
        message: 'Failed to create user message',
      });
      return;
    }

    // 3. Resume agent from user message
    const chatKey = messageMapKey({ agentId, topicId, threadId, scope });
    const currentMessages = displayMessageSelectors.getDisplayMessagesByKey(chatKey)(this.#get());

    const { state, context: initialContext } = this.#get().internal_createAgentState({
      messages: currentMessages,
      parentMessageId: userMsg.id,
      agentId,
      topicId,
      threadId: threadId ?? undefined,
      operationId,
    });

    try {
      await executeClientAgent({
        context: effectiveContext,
        messages: currentMessages,
        parentMessageId: userMsg.id,
        parentMessageType: 'user',
        initialState: state,
        initialContext,
        parentOperationId: operationId,
      });
      completeOperation(operationId);
    } catch (error) {
      const err = error as Error;
      console.error('[skipToolInteraction] Error executing agent runtime:', err);
      this.#get().failOperation(operationId, {
        type: 'skipToolInteraction',
        message: err.message || 'Unknown error',
      });
    }
  };

  cancelToolInteraction = async (
    toolMessageId: string,
    context?: ConversationContext,
  ): Promise<void> => {
    const { startOperation, completeOperation } = this.#get();

    const effectiveContext: ConversationContext = context ?? {
      agentId: this.#get().activeAgentId,
      topicId: this.#get().activeTopicId,
      threadId: this.#get().activeThreadId,
    };

    const { agentId, topicId, threadId, scope } = effectiveContext;

    const toolMessage = dbMessageSelectors.getDbMessageById(toolMessageId)(this.#get());
    if (!toolMessage) return;

    const { operationId } = startOperation({
      type: 'cancelToolInteraction',
      context: {
        agentId,
        topicId: topicId ?? undefined,
        threadId: threadId ?? undefined,
        scope,
        messageId: toolMessageId,
      },
    });

    const optimisticContext = { operationId };

    await this.#get().optimisticUpdateMessagePlugin(
      toolMessageId,
      { intervention: { rejectedReason: 'User cancelled interaction', status: 'rejected' } },
      optimisticContext,
    );

    const toolContent = 'User cancelled this interaction.';
    await this.#get().optimisticUpdateMessageContent(
      toolMessageId,
      toolContent,
      undefined,
      optimisticContext,
    );

    completeOperation(operationId);
  };

  rejectToolCalling = async (
    messageId: string,
    reason?: string,
    context?: ConversationContext,
  ): Promise<void> => {
    const { startOperation, completeOperation } = this.#get();

    // Build effective context from provided context or global state
    const effectiveContext: ConversationContext = context ?? {
      agentId: this.#get().activeAgentId,
      topicId: this.#get().activeTopicId,
      threadId: this.#get().activeThreadId,
    };

    const { agentId, topicId, threadId, scope } = effectiveContext;

    const toolMessage = dbMessageSelectors.getDbMessageById(messageId)(this.#get());
    if (!toolMessage) return;

    // Create an operation to carry the context for optimistic updates
    const { operationId } = startOperation({
      type: 'rejectToolCalling',
      context: {
        agentId,
        topicId: topicId ?? undefined,
        threadId: threadId ?? undefined,
        scope,
        messageId,
      },
    });

    const optimisticContext = { operationId };

    // Optimistic update - update status to rejected and save reason
    const intervention = {
      rejectedReason: reason,
      status: 'rejected',
    } as const;
    await this.#get().optimisticUpdateMessagePlugin(
      toolMessage.id,
      { intervention },
      optimisticContext,
    );

    const toolContent = !!reason
      ? `User reject this tool calling with reason: ${reason}`
      : 'User reject this tool calling without reason';

    await this.#get().optimisticUpdateMessageContent(
      messageId,
      toolContent,
      undefined,
      optimisticContext,
    );

    // Server-mode: start a **new** Gateway/SSE op carrying the rejection.
    // We use `rejected_continue` uniformly — server-side `rejected` and
    // `rejected_continue` share the same code path (both surface the
    // rejection to the LLM as user feedback), so a separate `rejected`
    // decision adds complexity without behavioural difference.
    if (this.#shouldUseGatewayResume(effectiveContext)) {
      const toolCallId = toolMessage.tool_call_id;
      if (!toolCallId) {
        console.warn(
          '[rejectToolCalling][server] tool message missing tool_call_id; skipping resume',
        );
        completeOperation(operationId);
        return;
      }
      const pausedOpIds = this.#getRunningServerOps(effectiveContext).map((op) => op.id);
      try {
        await this.#dispatchServerResume(effectiveContext, {
          decision: 'rejected_continue',
          parentMessageId: messageId,
          rejectionReason: reason,
          toolCallId,
        });
        this.#completeOpsById(pausedOpIds);
      } catch (error) {
        console.error('[rejectToolCalling][server] Resume failed:', error);
      }
    }

    completeOperation(operationId);
  };

  rejectAndContinueToolCalling = async (
    messageId: string,
    reason?: string,
    context?: ConversationContext,
  ): Promise<void> => {
    const toolMessage = dbMessageSelectors.getDbMessageById(messageId)(this.#get());
    if (!toolMessage) return;

    const { executeClientAgent, startOperation, completeOperation } = this.#get();

    // Build effective context from provided context or global state
    const effectiveContext: ConversationContext = context ?? {
      agentId: this.#get().activeAgentId,
      topicId: this.#get().activeTopicId,
      threadId: this.#get().activeThreadId,
    };

    const { agentId, topicId, threadId, scope } = effectiveContext;

    // Server-mode: start a **new** Gateway/SSE op with `decision='rejected_continue'`.
    // Server persists the rejection on the target tool message and resumes
    // the LLM loop with the rejection content surfaced as user feedback.
    // Skip the client-mode `rejectToolCalling` chain below — that would fire
    // a duplicate halting `reject` before this continue signal.
    if (this.#shouldUseGatewayResume(effectiveContext)) {
      const toolCallId = toolMessage.tool_call_id;
      if (!toolCallId) {
        console.warn(
          '[rejectAndContinueToolCalling][server] tool message missing tool_call_id; skipping resume',
        );
        return;
      }

      const pausedOpIds = this.#getRunningServerOps(effectiveContext).map((op) => op.id);

      const { operationId } = startOperation({
        type: 'rejectToolCalling',
        context: {
          agentId,
          topicId: topicId ?? undefined,
          threadId: threadId ?? undefined,
          scope,
          messageId,
        },
      });

      const optimisticContext = { operationId };
      await this.#get().optimisticUpdateMessagePlugin(
        messageId,
        { intervention: { rejectedReason: reason, status: 'rejected' } as any },
        optimisticContext,
      );
      const toolContent = reason
        ? `User reject this tool calling with reason: ${reason}`
        : 'User reject this tool calling without reason';
      await this.#get().optimisticUpdateMessageContent(
        messageId,
        toolContent,
        undefined,
        optimisticContext,
      );

      try {
        await this.#dispatchServerResume(effectiveContext, {
          decision: 'rejected_continue',
          parentMessageId: messageId,
          rejectionReason: reason,
          toolCallId,
        });
        this.#completeOpsById(pausedOpIds);
        completeOperation(operationId);
      } catch (error) {
        const err = error as Error;
        console.error('[rejectAndContinueToolCalling][server] Resume failed:', err);
        this.#get().failOperation(operationId, {
          type: 'rejectToolCalling',
          message: err.message || 'Unknown error',
        });
      }
      return;
    }

    // Client-mode path: reject first (persists rejection + updates content),
    // then spin up a local runtime with phase='user_input' to continue.
    await this.#get().rejectToolCalling(messageId, reason, context);

    // Create an operation to manage the continue execution
    const { operationId } = startOperation({
      type: 'rejectToolCalling',
      context: {
        agentId,
        topicId: topicId ?? undefined,
        threadId: threadId ?? undefined,
        scope,
        messageId,
      },
    });

    // Get current messages for state construction using context
    const chatKey = messageMapKey({ agentId, topicId, threadId, scope });
    const currentMessages = displayMessageSelectors.getDisplayMessagesByKey(chatKey)(this.#get());

    // Create agent state and context to continue from rejected tool message
    const { state, context: initialContext } = this.#get().internal_createAgentState({
      messages: currentMessages,
      parentMessageId: messageId,
      agentId,
      topicId,
      threadId: threadId ?? undefined,
      operationId,
    });

    // Override context with 'userInput' phase to continue as if user provided feedback
    const agentRuntimeContext: AgentRuntimeContext = {
      ...initialContext,
      phase: 'user_input',
    };

    // Execute agent runtime from rejected tool message position to continue
    try {
      await executeClientAgent({
        context: effectiveContext,
        messages: currentMessages,
        parentMessageId: messageId,
        parentMessageType: 'tool',
        initialState: state,
        initialContext: agentRuntimeContext,
        // Pass parent operation ID to establish parent-child relationship
        parentOperationId: operationId,
      });
      completeOperation(operationId);
    } catch (error) {
      const err = error as Error;
      console.error('[rejectAndContinueToolCalling] Error executing agent runtime:', err);
      this.#get().failOperation(operationId, {
        type: 'rejectToolCalling',
        message: err.message || 'Unknown error',
      });
    }
  };
}

export type ConversationControlAction = Pick<
  ConversationControlActionImpl,
  keyof ConversationControlActionImpl
>;
