import { type AgentRuntimeContext } from '@lobechat/agent-runtime';
import { type ConversationContext } from '@lobechat/types';

import {
  type AgentInterventionSourceAction,
  aiAgentService,
  type ResolveAgentInterventionBySourceResult,
} from '@/services/aiAgent';
import { shareChatService } from '@/services/shareChat';
import { dbMessageSelectors } from '@/store/chat/slices/message/selectors';
import { type ChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useUserStore } from '@/store/user';

import {
  createApprovedToolCall,
  getAddressableApprovalDecisions,
  refreshApprovedToolCall,
} from './approvalResume';
import { readClientRunMessages } from './ensureFullHistoryForClientRun';
import {
  shouldUseConfiguredGatewayResume as resolveConfiguredGatewayResume,
  shouldUseGatewayResume as resolveGatewayResume,
} from './gatewayResume';
import { type createInterventionProjection } from './interventionProjection';
import {
  completeOpsById,
  discardAlreadyResolvedSource,
  emitRunResumed,
  getRequestMetadataFromMessageChain,
  getRunningServerOps,
  writeTopicStatus,
} from './resumeContext';

type InterventionProjection = ReturnType<typeof createInterventionProjection>;

interface ApprovalActionsParams {
  get: () => ChatStore;
  interventions: InterventionProjection;
  tryResolveAgentInterventionBySource: (params: {
    action: AgentInterventionSourceAction;
    context?: ConversationContext;
    toolMessageIds: string[];
  }) => Promise<ResolveAgentInterventionBySourceResult>;
}

export const createApprovalActions = ({
  get,
  interventions,
  tryResolveAgentInterventionBySource,
}: ApprovalActionsParams) => {
  /** Resolve the source first; false falls through to the original client path. */
  const resumeGatewayApproval = async (approval: {
    action: AgentInterventionSourceAction;
    anchorMessageId: string;
    context: ConversationContext;
    logTag: string;
    /** Runs once the resumed run started; `handled` means the source store took the decision. */
    onClaimed?: (handled: boolean) => Promise<void>;
    operationId: string;
    prepareLegacy?: () => Promise<void>;
    /** Resume through the message-row claim when no source store handles the decision. */
    resumeLegacy: (params: Parameters<ChatStore['executeGatewayAgent']>[0]) => Promise<unknown>;
    rollbackLocalDecision: () => void;
    toolMessageIds: string[];
  }): Promise<boolean> => {
    const { anchorMessageId, context, logTag, operationId, toolMessageIds } = approval;
    const isStopped = () => get().operations[operationId]?.status === 'cancelled';
    const settleStopped = () => {
      interventions.rollback(toolMessageIds);
      return get()
        .refreshMessages(context)
        .catch((error) => console.error(`${logTag} refresh after Stop failed:`, error));
    };
    if (isStopped()) {
      approval.rollbackLocalDecision();
      return true;
    }

    // Retired only once the resume starts, so a retry still sees Gateway mode.
    const pausedOpIds = getRunningServerOps(get, context).map((op) => op.id);
    const params = {
      context,
      message: '',
      metadata: getRequestMetadataFromMessageChain(get, anchorMessageId),
      parentMessageId: anchorMessageId,
      parentOperationId: operationId,
    };
    try {
      const sourceResolution = await tryResolveAgentInterventionBySource({
        action: approval.action,
        context,
        toolMessageIds,
      });
      if (discardAlreadyResolvedSource(get, sourceResolution, operationId)) return true;
      if (!sourceResolution.handled) {
        const gateway = await resolveConfiguredGatewayResume(context, get);
        if (!gateway && isStopped()) {
          approval.rollbackLocalDecision();
          return true;
        }
        await approval.prepareLegacy?.();
        if (!gateway) return false;
      }

      emitRunResumed(get, context, {
        operationId,
        parentMessageId: anchorMessageId,
        runtimeType: 'gateway',
      });
      if (!sourceResolution.handled) await approval.resumeLegacy(params);
      else if (sourceResolution.execution) {
        await get().executeGatewayAgent({
          ...params,
          precreatedResult: sourceResolution.execution,
        });
      }
      await approval.onClaimed?.(sourceResolution.handled);
      // The server took the decision. A stopped run never writes its own status,
      // so force past the local row: it already reads `active` (pinned when the
      // paused run ended) while the server's still reads `waitingForHuman`.
      writeTopicStatus(get, context, 'active', isStopped());
      completeOpsById(get, pausedOpIds);
      if (isStopped()) {
        await settleStopped();
        return true;
      }
      get().completeOperation(operationId);
      return true;
    } catch (error) {
      if (isStopped()) {
        await settleStopped();
        return true;
      }
      const err = error as Error;
      console.error(`${logTag} Gateway resume failed:`, err);
      approval.rollbackLocalDecision();
      get().failOperation(operationId, {
        type: 'approveToolCalling',
        message: err.message || 'Unknown error',
      });
      throw error;
    }
  };

  const approveToolCalling = async (
    toolMessageId: string,
    _assistantGroupId: string,
    context?: ConversationContext,
    options?: {
      editedArguments?: Record<string, unknown>;
      onLegacyEditFallback?: () => Promise<void>;
      rememberToolKey?: string;
    },
  ): Promise<void> => {
    const { executeClientAgent, startOperation, completeOperation } = get();

    // Build effective context from provided context or global state
    const effectiveContext: ConversationContext = context ?? {
      agentId: get().activeAgentId,
      topicId: get().activeTopicId,
      threadId: get().activeThreadId,
    };

    const { agentId, topicId, threadId, scope } = effectiveContext;

    // 1. Get tool message and verify it exists
    const toolMessage = dbMessageSelectors.getDbMessageById(toolMessageId)(get());
    if (!toolMessage) return;
    let approvedToolCall = createApprovedToolCall(toolMessage.plugin, toolMessage.tool_call_id);

    // Create an operation to carry the context for optimistic updates
    // This ensures optimistic updates use the correct agentId/topicId
    const { operationId } = startOperation({
      type: 'approveToolCalling',
      // Carry the full effective context (groupId / documentId / scope / …) so the
      // interim op lands in the same messageMapKey bucket the UI queries. A cherry-
      // picked context without groupId would bucket group conversations under
      // `main_<agentId>` while the UI reads `group_<groupId>`, so the input-loading
      // whitelist never matches there. Mirrors execServerAgentRuntime's execContext.
      context: {
        ...effectiveContext,
        messageId: toolMessageId,
      },
    });

    const optimisticContext = { operationId };
    const rollbackLocalDecision = interventions.applyLocalDecision(
      [toolMessageId],
      { status: 'approved' },
      optimisticContext,
    );
    const shouldUseGatewayResume = await resolveGatewayResume(
      effectiveContext,
      [toolMessageId],
      get,
    );

    // Local runtime persists the decision itself. A Gateway claim needs the row still
    // `pending` on the server, so it must not persist an optimistic approval first.

    if (shouldUseGatewayResume) {
      const toolCallId = toolMessage.tool_call_id;
      if (!toolCallId) {
        console.warn(
          '[approveToolCalling][server] tool message missing tool_call_id; skipping resume',
        );
        rollbackLocalDecision();
        completeOperation(operationId);
        return;
      }
      // A share run belongs to the agent's owner, so a server-side `remember`
      // would write the OWNER's allow list (the share mirror rejects it). A
      // visitor's "don't ask again" approves once and lands in their own allow
      // list instead, which their share runs send as `userInterventionConfig`.
      const remembersOnServer = !!options?.rememberToolKey && !effectiveContext.agentShareId;
      if (
        await resumeGatewayApproval({
          action: {
            ...(options?.editedArguments && {
              edits: { [toolMessageId]: options.editedArguments },
            }),
            scope: remembersOnServer ? 'remember' : 'once',
            type: 'approve_tool',
          },
          anchorMessageId: toolMessageId,
          context: effectiveContext,
          logTag: '[approveToolCalling][server]',
          onClaimed: async (handled) => {
            if (options?.rememberToolKey && !(handled && remembersOnServer)) {
              await useUserStore.getState().addToolToAllowList(options.rememberToolKey);
            }
          },
          operationId,
          prepareLegacy: async () => {
            if (!options?.editedArguments) return;
            await options.onLegacyEditFallback?.();
            const refreshedToolMessage = dbMessageSelectors.getDbMessageById(toolMessageId)(get());
            approvedToolCall = refreshApprovedToolCall(approvedToolCall, refreshedToolMessage);
          },
          resumeLegacy: async (params) => {
            await get().executeGatewayAgent({
              ...params,
              resumeApproval: { decision: 'approved', parentMessageId: toolMessageId, toolCallId },
            });
          },
          rollbackLocalDecision,
          toolMessageIds: [toolMessageId],
        })
      )
        return;
    }

    writeTopicStatus(get, effectiveContext, 'active');
    // Park → resume: a new op continues the run paused on this tool's approval.
    emitRunResumed(get, effectiveContext, {
      operationId,
      parentMessageId: toolMessageId,
      runtimeType: 'client',
    });
    await interventions.settleAfter([toolMessageId], () =>
      get().optimisticUpdateMessagePlugin(
        toolMessageId,
        { intervention: { status: 'approved' } },
        optimisticContext,
      ),
    );

    // 3. Get current messages for state construction using context
    const chatKey = messageMapKey({ agentId, topicId, threadId, scope });
    const currentMessages = await readClientRunMessages(get, effectiveContext, chatKey);
    const currentRequestMetadata = getRequestMetadataFromMessageChain(
      get,
      toolMessageId,
      currentMessages,
    );

    // 4. Create agent state and context with user intervention config
    const { state, context: initialContext } = get().internal_createAgentState({
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
        approvedToolCall,
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
        metadata: currentRequestMetadata,
        // Pass parent operation ID to establish parent-child relationship
        // This ensures proper cancellation propagation
        parentOperationId: operationId,
      });
      if (options?.rememberToolKey) {
        await useUserStore.getState().addToolToAllowList(options.rememberToolKey);
      }
      completeOperation(operationId);
    } catch (error) {
      const err = error as Error;
      console.error('[approveToolCalling] Error executing agent runtime:', err);
      get().failOperation(operationId, {
        type: 'approveToolCalling',
        message: err.message || 'Unknown error',
      });
    }
  };

  /** Stop the authoritative sealed batch; a parked run no longer has an active client operation. */
  const stopPendingApproval = async (
    toolMessageIds: string[],
    context?: ConversationContext,
  ): Promise<void> => {
    if (toolMessageIds.length === 0) return;

    const effectiveContext: ConversationContext = context ?? {
      agentId: get().activeAgentId,
      topicId: get().activeTopicId,
      threadId: get().activeThreadId,
    };

    const topicId = effectiveContext.topicId;
    if (!topicId) {
      console.warn('[stopPendingApproval] no active topic; skipping');
      return;
    }

    // Only rows the server can address — an optimistic `tmp_` row has no server
    // identity yet.
    const addressable = toolMessageIds.filter((id) => !id.startsWith('tmp_'));
    if (addressable.length === 0) return;

    const targets = addressable.map((id) => dbMessageSelectors.getDbMessageById(id)(get()));
    const operationId = targets[0]?.pluginIntervention?.operationId;
    const batchId = targets[0]?.pluginIntervention?.batchId;
    if (
      !operationId ||
      !batchId ||
      targets.some(
        (message) =>
          !message ||
          message.pluginIntervention?.operationId !== operationId ||
          message.pluginIntervention?.batchId !== batchId,
      )
    ) {
      console.warn('[stopPendingApproval] missing or mixed authoritative batch identity; skipping');
      return;
    }

    const pausedOpIds = getRunningServerOps(get, effectiveContext).map((op) => op.id);

    try {
      const sourceResolution = await tryResolveAgentInterventionBySource({
        action: { scope: 'operation', type: 'stop' },
        context: effectiveContext,
        toolMessageIds: addressable,
      });
      if (discardAlreadyResolvedSource(get, sourceResolution)) return;

      if (!sourceResolution.handled) {
        const stopParams = { batchId, operationId, toolMessageIds: addressable, topicId };
        await (effectiveContext.agentShareId
          ? shareChatService.stopPendingApproval(effectiveContext.agentShareId, stopParams)
          : aiAgentService.stopPendingApproval(stopParams));
      }
      // Settle the cards locally. A group member's stop ends no stream this
      // client still listens on, so no refetch would ever land the aborted rows
      // and the card would stay on screen until a reload.
      for (const id of addressable) {
        interventions.dispatch(id, { status: 'aborted' }, { context: effectiveContext });
      }
      completeOpsById(get, pausedOpIds);
    } catch (error) {
      console.error('[stopPendingApproval] failed:', error);
      throw error;
    }
  };

  const approveAllToolCalls = async (
    toolMessageIds: string[],
    context?: ConversationContext,
  ): Promise<void> => {
    if (toolMessageIds.length === 0) return;

    const effectiveContext: ConversationContext = context ?? {
      agentId: get().activeAgentId,
      topicId: get().activeTopicId,
      threadId: get().activeThreadId,
    };

    if (!(await resolveGatewayResume(effectiveContext, toolMessageIds, get))) {
      for (const toolMessageId of toolMessageIds) {
        await approveToolCalling(toolMessageId, '', effectiveContext);
      }
      return;
    }

    const { startOperation } = get();

    // Drop anything that can't be addressed: an optimistic row (`tmp_`) has no
    // server identity yet, and a tool message without `tool_call_id` can't be
    // matched to its pending call.
    const decisions = getAddressableApprovalDecisions(toolMessageIds, (toolMessageId) =>
      dbMessageSelectors.getDbMessageById(toolMessageId)(get()),
    );

    if (decisions.length === 0) {
      console.warn('[approveAllToolCalls][server] no addressable pending tools; skipping resume');
      return;
    }

    // The op-level anchor. The server re-derives the spine anchor from the
    // batch itself, so this only has to be one of the batch's own rows.
    const anchorMessageId = decisions.at(-1)!.parentMessageId;
    const approvedIds = decisions.map(({ parentMessageId }) => parentMessageId);

    const { operationId } = startOperation({
      type: 'approveToolCalling',
      context: { ...effectiveContext, messageId: anchorMessageId },
    });
    const rollbackLocalDecision = interventions.applyLocalDecision(
      approvedIds,
      { status: 'approved' },
      { operationId },
    );

    const resumed = await resumeGatewayApproval({
      action: { scope: 'once', type: 'approve_tool' },
      anchorMessageId,
      context: effectiveContext,
      logTag: '[approveAllToolCalls][server]',
      operationId,
      resumeLegacy: (params) =>
        get().executeGatewayAgent({ ...params, resumeApprovals: decisions }),
      rollbackLocalDecision,
      toolMessageIds: approvedIds,
    });
    if (!resumed) {
      get().completeOperation(operationId);
      for (const toolMessageId of toolMessageIds) {
        await approveToolCalling(toolMessageId, '', effectiveContext);
      }
    }
  };

  return { approveAllToolCalls, approveToolCalling, stopPendingApproval };
};
