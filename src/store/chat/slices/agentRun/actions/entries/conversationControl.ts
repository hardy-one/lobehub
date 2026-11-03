// Disable the auto sort key eslint rule to make the code more logic and readable
import { type AgentRuntimeContext } from '@lobechat/agent-runtime';
import { type ConversationContext } from '@lobechat/types';
import { t } from 'i18next';

import {
  type AgentInterventionSourceAction,
  aiAgentService,
  type ResolveAgentInterventionBySourceResult,
} from '@/services/aiAgent';
import { shareChatService } from '@/services/shareChat';
import { type OptimisticUpdateContext } from '@/store/chat/slices/message/actions/optimisticUpdate';
import { dbMessageSelectors } from '@/store/chat/slices/message/selectors';
import { type ChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { type StoreSetter } from '@/store/types';

import { createApprovalActions } from './approvalActions';
import {
  cancelSendMessageInServer,
  clearSendMessageError,
  stopGenerateMessage,
  switchMessageBranch,
} from './conversationOperationControl';
import { readClientRunMessages } from './ensureFullHistoryForClientRun';
import {
  shouldUseConfiguredGatewayResume as resolveConfiguredGatewayResume,
  shouldUseGatewayResume as resolveGatewayResume,
} from './gatewayResume';
import { submitHeteroIntervention } from './heteroIntervention';
import { createInterventionProjection } from './interventionProjection';
import { setInterventionAnswers, setInterventionDraft } from './interventionState';
import {
  canonicalizeResolutionPayload,
  completeOpsById,
  discardAlreadyResolvedSource,
  emitRunResumed,
  getRequestMetadataFromMessageChain,
  getRunningServerOps,
  interactionTurnParentId,
  toAgentInterventionAnswerResult,
  wasInterimOpStopped,
  writeTopicStatus,
} from './resumeContext';

/**
 * Actions for controlling conversation operations like cancellation and error handling
 */

type Setter = StoreSetter<ChatStore>;

export const conversationControl = (set: Setter, get: () => ChatStore, _api?: unknown) =>
  new ConversationControlActionImpl(set, get, _api);

export class ConversationControlActionImpl {
  readonly #get: () => ChatStore;
  /** Stable generic claim key shared by retries of one active Web action. */
  readonly #interventionResolutionRequestIds = new Map<string, string>();
  /** Stable per-intervention idempotency key reused by transport retries. */
  readonly #heteroResolutionRequestIds = new Map<string, string>();
  readonly #interventions = createInterventionProjection(() => this.#get());
  readonly #approvalActions: ReturnType<typeof createApprovalActions>;

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    void set;
    this.#get = get;
    this.#approvalActions = createApprovalActions({
      get,
      interventions: this.#interventions,
      tryResolveAgentInterventionBySource: (params) =>
        this.tryResolveAgentInterventionBySource(params),
    });
  }

  /**
   * Resolve an active Gateway card through the same durable generic claim as
   * Mobile/notifications. Returns false only when the deployment has no
   * generic intervention store, allowing the existing OSS path to continue.
   */
  tryResolveAgentInterventionBySource = async (params: {
    action: AgentInterventionSourceAction;
    context?: ConversationContext;
    toolMessageIds: string[];
  }): Promise<ResolveAgentInterventionBySourceResult> => {
    const targets = params.toolMessageIds.map((toolMessageId) => {
      const message = dbMessageSelectors.getDbMessageById(toolMessageId)(this.#get());
      return {
        batchId: message?.pluginIntervention?.batchId,
        operationId: message?.pluginIntervention?.operationId,
        toolCallId: message?.tool_call_id,
        toolMessageId,
      };
    });
    const first = targets[0];
    if (
      !first?.batchId ||
      !first.operationId ||
      targets.some(
        (target) =>
          !target.toolCallId ||
          target.batchId !== first.batchId ||
          target.operationId !== first.operationId,
      )
    ) {
      return { handled: false };
    }

    const sourceTargets = targets.map(({ toolCallId, toolMessageId }) => ({
      toolCallId: toolCallId!,
      toolMessageId,
    }));
    const resolutionKey = JSON.stringify(
      canonicalizeResolutionPayload({
        action: params.action,
        batchId: first.batchId,
        operationId: first.operationId,
        targets: sourceTargets,
      }),
    );
    const resolutionRequestId =
      this.#interventionResolutionRequestIds.get(resolutionKey) ?? globalThis.crypto.randomUUID();
    this.#interventionResolutionRequestIds.set(resolutionKey, resolutionRequestId);

    const sourceParams = {
      action: params.action,
      batchId: first.batchId,
      operationId: first.operationId,
      resolutionRequestId,
      targets: sourceTargets,
    };
    // A share visitor answers their own share run through the share-authorized
    // mirror; the owner-scoped endpoint would reject them.
    const agentShareId = params.context?.agentShareId;
    const result = agentShareId
      ? params.context?.topicId
        ? await shareChatService.resolveInterventionBySource(
            agentShareId,
            params.context.topicId,
            sourceParams,
          )
        : ({ handled: false } as const)
      : await aiAgentService.resolveAgentInterventionBySource(sourceParams);
    if (result.handled) {
      this.#interventionResolutionRequestIds.delete(resolutionKey);
      // The server owns the decision now: keep a claimed one, undo a lost one before the refresh.
      if (result.state === 'claimed') this.#interventions.settle(params.toolMessageIds);
      else this.#interventions.rollback(params.toolMessageIds);
      if (result.state === 'claimed' && params.context) {
        for (const id of params.toolMessageIds) {
          this.#get().internal_confirmQuestionSubmission(id, params.action, params.context);
        }
      }
      if (result.state === 'already_resolved' && params.context) {
        const submittingQuestions = params.toolMessageIds.filter(
          (id) => this.#get().questionSubmissions[id],
        );
        if (submittingQuestions.length > 0) {
          await Promise.all(
            submittingQuestions.map((id) =>
              this.#get().checkQuestionSubmission(id, params.context!),
            ),
          );
        } else {
          await this.#get().refreshMessages(params.context);
        }
      }
    }
    return result;
  };

  stopGenerateMessage = (): void => stopGenerateMessage(this.#get);

  cancelSendMessageInServer = (
    target?: string | ConversationContext,
    editor?: Parameters<typeof cancelSendMessageInServer>[0]['editor'],
  ): void => cancelSendMessageInServer({ editor, get: this.#get, target });

  clearSendMessageError = (): void => clearSendMessageError(this.#get);

  switchMessageBranch = async (
    messageId: string,
    branchIndex: number,
    context?: OptimisticUpdateContext,
  ): Promise<void> => switchMessageBranch({ branchIndex, context, get: this.#get, messageId });

  approveToolCalling = async (
    toolMessageId: string,
    assistantGroupId: string,
    context?: ConversationContext,
    options?: {
      editedArguments?: Record<string, unknown>;
      onLegacyEditFallback?: () => Promise<void>;
      rememberToolKey?: string;
    },
  ): Promise<void> =>
    this.#approvalActions.approveToolCalling(toolMessageId, assistantGroupId, context, options);

  /** Stop the authoritative sealed batch; a parked run no longer has an active client operation. */
  stopPendingApproval = async (
    toolMessageIds: string[],
    context?: ConversationContext,
  ): Promise<void> => this.#approvalActions.stopPendingApproval(toolMessageIds, context);

  approveAllToolCalls = async (
    toolMessageIds: string[],
    context?: ConversationContext,
  ): Promise<void> => this.#approvalActions.approveAllToolCalls(toolMessageIds, context);

  submitToolInteraction = async (
    toolMessageId: string,
    response: Record<string, unknown>,
    context?: ConversationContext,
    options?: {
      agentInterventionAction?: Extract<
        AgentInterventionSourceAction,
        { type: 'submit_answers' | 'submit_custom' }
      >;
      createUserMessage?: boolean;
      prepareLegacyFallback?: () => Promise<{
        createUserMessage?: boolean;
        pluginState?: Record<string, unknown>;
        response: Record<string, unknown>;
        toolResultContent?: string;
      }>;
      pluginState?: Record<string, unknown>;
      toolResultContent?: string;
    },
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
      // Carry the full effective context so the interim op is bucketed under the
      // same messageMapKey the UI queries (group / page need groupId / documentId,
      // not just agentId) — otherwise the input-loading whitelist never matches
      // there. Mirrors execServerAgentRuntime's execContext.
      context: {
        ...effectiveContext,
        messageId: toolMessageId,
      },
    });

    const optimisticContext: OptimisticUpdateContext = { operationId };
    let resolvedOptions = options;
    let resolvedResponse = response;
    const shouldUseGatewayResume = await resolveGatewayResume(
      effectiveContext,
      [toolMessageId],
      this.#get,
    );

    let toolContent =
      resolvedOptions?.toolResultContent ?? `User submitted: ${JSON.stringify(resolvedResponse)}`;

    if (shouldUseGatewayResume) {
      const toolCallId = toolMessage.tool_call_id;
      if (!toolCallId) {
        console.warn(
          '[submitToolInteraction][server] tool message missing tool_call_id; skipping resume',
        );
        completeOperation(operationId);
        return;
      }
      const requestMetadata = getRequestMetadataFromMessageChain(this.#get, toolMessageId);
      // Retire paused operations only after a successful server resume.
      const pausedOpIds = getRunningServerOps(this.#get, effectiveContext).map((op) => op.id);
      try {
        const answerResult = toAgentInterventionAnswerResult(resolvedResponse);
        const sourceAction =
          resolvedOptions?.agentInterventionAction ??
          (answerResult ? ({ result: answerResult, type: 'submit_answers' } as const) : undefined);
        const sourceResolution = sourceAction
          ? await this.tryResolveAgentInterventionBySource({
              action: sourceAction,
              context: effectiveContext,
              toolMessageIds: [toolMessageId],
            })
          : { handled: false as const };

        if (discardAlreadyResolvedSource(this.#get, sourceResolution, operationId)) return;

        if (!sourceResolution.handled) {
          const legacyFallback = await resolvedOptions?.prepareLegacyFallback?.();
          if (legacyFallback) {
            resolvedResponse = legacyFallback.response;
            resolvedOptions = { ...resolvedOptions, ...legacyFallback };
            toolContent =
              resolvedOptions.toolResultContent ??
              `User submitted: ${JSON.stringify(resolvedResponse)}`;
          }
        }

        if (
          sourceResolution.handled ||
          (await resolveConfiguredGatewayResume(effectiveContext, this.#get))
        ) {
          emitRunResumed(this.#get, effectiveContext, {
            operationId,
            parentMessageId: toolMessageId,
            runtimeType: 'gateway',
          });

          if (sourceResolution.handled) {
            if (sourceResolution.execution) {
              await this.#get().executeGatewayAgent({
                context: effectiveContext,
                message: '',
                metadata: requestMetadata,
                parentMessageId: toolMessageId,
                precreatedResult: sourceResolution.execution,
              });
            }
          } else {
            await this.#get().executeGatewayAgent({
              context: effectiveContext,
              message: '',
              metadata: requestMetadata,
              parentMessageId: toolMessageId,
              resumeToolResult: {
                content: toolContent,
                outcome: 'submitted',
                parentMessageId: toolMessageId,
                toolCallId,
                ...(resolvedOptions?.pluginState
                  ? { pluginState: resolvedOptions.pluginState }
                  : {}),
              },
            });
          }
          writeTopicStatus(this.#get, effectiveContext, 'active');
          completeOpsById(this.#get, pausedOpIds);
          completeOperation(operationId);
          return;
        }
      } catch (error) {
        const err = error as Error;
        console.error('[submitToolInteraction][server] Gateway resume failed:', err);
        this.#get().failOperation(operationId, {
          type: 'submitToolInteraction',
          message: err.message || 'Unknown error',
        });
        throw error;
      }
    }

    const shouldCreateUserMessage = resolvedOptions?.createUserMessage !== false;
    writeTopicStatus(this.#get, effectiveContext, 'active');
    // Park → resume: a new op continues the run paused on this tool interaction.
    emitRunResumed(this.#get, effectiveContext, {
      operationId,
      parentMessageId: toolMessageId,
      runtimeType: 'client',
    });
    // Client runtime owns its local pending row. Gateway must leave the DB
    // row pending until resumeToolResult acquires the server-side CAS.
    await this.#get().optimisticUpdateMessagePlugin(
      toolMessageId,
      { intervention: { status: 'approved' } },
      optimisticContext,
    );
    await this.#get().optimisticUpdateMessageContent(
      toolMessageId,
      toolContent,
      undefined,
      optimisticContext,
    );

    if (resolvedOptions?.pluginState) {
      await this.#get().optimisticUpdatePluginState(
        toolMessageId,
        resolvedOptions.pluginState,
        optimisticContext,
      );
    }

    const chatKey = messageMapKey({ agentId, topicId, threadId, scope });

    // A completed interaction result resumes without a synthetic user message or tool re-execution.
    if (!shouldCreateUserMessage) {
      const currentMessages = await readClientRunMessages(this.#get, effectiveContext, chatKey);
      const requestMetadata = getRequestMetadataFromMessageChain(
        this.#get,
        toolMessageId,
        currentMessages,
      );

      const { state, context: initialContext } = this.#get().internal_createAgentState({
        messages: currentMessages,
        parentMessageId: toolMessageId,
        agentId,
        topicId,
        threadId: threadId ?? undefined,
        operationId,
      });

      // The UI already stored the result; do not execute the intervention tool again.
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
          metadata: requestMetadata,
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
    const requestMetadata = getRequestMetadataFromMessageChain(this.#get, toolMessageId);
    const userMessageContent = Object.values(resolvedResponse).join(', ');
    const groupId = toolMessage.groupId;
    const userMsg = await this.#get().optimisticCreateMessage(
      {
        agentId: agentId!,
        content: userMessageContent,
        groupId: groupId ?? undefined,
        ...(requestMetadata && { metadata: requestMetadata }),
        parentId: interactionTurnParentId(toolMessage),
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

    // Bail if a Stop landed while the synthetic user message was being created:
    // optimisticCreateMessage above is another await round-trip after the earlier
    // guard, and executeClientAgent would otherwise start a fresh child run that
    // wasn't present when the cancellation propagated.
    const currentMessages = await readClientRunMessages(this.#get, effectiveContext, chatKey);
    if (wasInterimOpStopped(this.#get, operationId)) return;

    // 3. Resume agent from user message (not tool re-execution)
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
        metadata: requestMetadata,
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
    options?: { onLegacyFallback?: () => Promise<void> },
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
      // Carry the full effective context so the interim op is bucketed under the
      // same messageMapKey the UI queries (group / page need groupId / documentId,
      // not just agentId) — otherwise the input-loading whitelist never matches
      // there. Mirrors execServerAgentRuntime's execContext.
      context: {
        ...effectiveContext,
        messageId: toolMessageId,
      },
    });

    const optimisticContext: OptimisticUpdateContext = { operationId };
    const shouldUseGatewayResume = await resolveGatewayResume(
      effectiveContext,
      [toolMessageId],
      this.#get,
    );

    const toolContent = reason ? `User skipped: ${reason}` : 'User skipped this question.';

    // Gateway owns the pending-row claim. Do not persist an optimistic
    // `rejected` state first: the authoritative resume endpoint deliberately
    // accepts only pending rows, so a client-side write would make its own
    // request lose the first-winner CAS.
    if (shouldUseGatewayResume) {
      const toolCallId = toolMessage.tool_call_id;
      if (!toolCallId) {
        console.warn(
          '[skipToolInteraction][server] tool message missing tool_call_id; skipping resume',
        );
        completeOperation(operationId);
        return;
      }
      const requestMetadata = getRequestMetadataFromMessageChain(this.#get, toolMessageId);
      const pausedOpIds = getRunningServerOps(this.#get, effectiveContext).map((op) => op.id);
      try {
        const sourceResolution = await this.tryResolveAgentInterventionBySource({
          action: { type: 'skip_interaction' },
          context: effectiveContext,
          toolMessageIds: [toolMessageId],
        });
        if (discardAlreadyResolvedSource(this.#get, sourceResolution, operationId)) return;
        if (!sourceResolution.handled) await options?.onLegacyFallback?.();

        if (
          sourceResolution.handled ||
          (await resolveConfiguredGatewayResume(effectiveContext, this.#get))
        ) {
          emitRunResumed(this.#get, effectiveContext, {
            operationId,
            parentMessageId: toolMessageId,
            runtimeType: 'gateway',
          });
          if (sourceResolution.handled) {
            if (sourceResolution.execution) {
              await this.#get().executeGatewayAgent({
                context: effectiveContext,
                message: '',
                metadata: requestMetadata,
                parentMessageId: toolMessageId,
                precreatedResult: sourceResolution.execution,
              });
            }
          } else {
            await this.#get().executeGatewayAgent({
              context: effectiveContext,
              message: '',
              metadata: requestMetadata,
              parentMessageId: toolMessageId,
              resumeToolResult: {
                content: toolContent,
                outcome: 'skipped',
                parentMessageId: toolMessageId,
                rejectionReason: reason,
                toolCallId,
              },
            });
          }
          writeTopicStatus(this.#get, effectiveContext, 'active');
          completeOpsById(this.#get, pausedOpIds);
          completeOperation(operationId);
          return;
        }
      } catch (error) {
        const err = error as Error;
        console.error('[skipToolInteraction][server] Gateway resume failed:', err);
        this.#get().failOperation(operationId, {
          type: 'skipToolInteraction',
          message: err.message || 'Unknown error',
        });
        throw error;
      }
    }

    writeTopicStatus(this.#get, effectiveContext, 'active');
    // Park → resume: a new op continues the run paused on this tool interaction.
    emitRunResumed(this.#get, effectiveContext, {
      operationId,
      parentMessageId: toolMessageId,
      runtimeType: 'client',
    });

    // 1. Mark intervention as rejected (skipped) with reason
    await this.#get().optimisticUpdateMessagePlugin(
      toolMessageId,
      { intervention: { rejectedReason: reason, skipped: true, status: 'rejected' } },
      optimisticContext,
    );

    await this.#get().optimisticUpdateMessageContent(
      toolMessageId,
      toolContent,
      undefined,
      optimisticContext,
    );

    // Bail if a Stop landed while the optimistic updates above were in flight,
    // before creating the synthetic user message so Stop leaves no dangling turn.
    if (wasInterimOpStopped(this.#get, operationId)) return;

    // 2. Create a user message indicating the skip
    const chatKey = messageMapKey({ agentId, topicId, threadId, scope });
    const requestMetadata = getRequestMetadataFromMessageChain(this.#get, toolMessageId);
    const userMessageContent = reason
      ? t('tool.intervention.skipMessageWithReason', { ns: 'chat', reason })
      : t('tool.intervention.skipMessage', { ns: 'chat' });
    const groupId = toolMessage.groupId;
    const userMsg = await this.#get().optimisticCreateMessage(
      {
        agentId: agentId!,
        content: userMessageContent,
        groupId: groupId ?? undefined,
        ...(requestMetadata && { metadata: requestMetadata }),
        parentId: interactionTurnParentId(toolMessage),
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

    // Bail if a Stop landed while the synthetic user message was being created:
    // optimisticCreateMessage above is another await round-trip after the guard
    // before it, and executeClientAgent would otherwise start a fresh child run
    // that wasn't present when the cancellation propagated.
    const currentMessages = await readClientRunMessages(this.#get, effectiveContext, chatKey);
    if (wasInterimOpStopped(this.#get, operationId)) return;

    // 3. Resume agent from user message
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
        metadata: requestMetadata,
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
    options?: { onLegacyFallback?: () => Promise<void> },
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
    const shouldUseGatewayStop = await resolveGatewayResume(
      effectiveContext,
      [toolMessageId],
      this.#get,
    );

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

    // A Gateway custom cancel is terminal: recordCustomInteractionResolution
    // has already persisted the custom side effect, then this path stops the
    // authoritative parked operation and its complete sealed batch. It must
    // not merely paint the one card rejected and leave the server op waiting.
    if (shouldUseGatewayStop) {
      const batchId = toolMessage.pluginIntervention?.batchId;
      const parkedOperationId = toolMessage.pluginIntervention?.operationId;
      if (!batchId || !parkedOperationId) {
        console.warn('[cancelToolInteraction][server] missing authoritative batch identity');
        completeOperation(operationId);
        return;
      }

      const batchToolMessageIds = [
        ...new Set(
          Object.values(this.#get().dbMessagesMap)
            .flat()
            .filter(
              (message) =>
                message.role === 'tool' &&
                message.pluginIntervention?.batchId === batchId &&
                message.pluginIntervention?.operationId === parkedOperationId,
            )
            .map(({ id }) => id),
        ),
      ];
      try {
        const sourceResolution = await this.tryResolveAgentInterventionBySource({
          action: { type: 'cancel_interaction' },
          context: effectiveContext,
          toolMessageIds: [toolMessageId],
        });
        if (discardAlreadyResolvedSource(this.#get, sourceResolution, operationId)) return;
        if (!sourceResolution.handled) await options?.onLegacyFallback?.();

        if (
          sourceResolution.handled ||
          (await resolveConfiguredGatewayResume(effectiveContext, this.#get))
        ) {
          if (!sourceResolution.handled) {
            await this.stopPendingApproval(
              batchToolMessageIds.length > 0 ? batchToolMessageIds : [toolMessageId],
              effectiveContext,
            );
          }
          completeOperation(operationId);
          return;
        }
      } catch (error) {
        const err = error as Error;
        this.#get().failOperation(operationId, {
          type: 'cancelToolInteraction',
          message: err.message || 'Unknown error',
        });
        throw error;
      }
    }

    writeTopicStatus(this.#get, effectiveContext, 'active');

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

  /**
   * Resolve a heterogeneous-runtime intervention through the IPC or remote
   * producer transport captured by the card and its operation.
   */
  submitHeteroIntervention = async (
    toolMessageId: string,
    actionType: 'submit' | 'skip' | 'cancel',
    payload?: Record<string, unknown>,
    context?: ConversationContext,
  ): Promise<void> =>
    submitHeteroIntervention({
      actionType,
      context,
      get: this.#get,
      heteroResolutionRequestIds: this.#heteroResolutionRequestIds,
      interventions: this.#interventions,
      payload,
      toolMessageId,
      tryResolveAgentInterventionBySource: (params) =>
        this.tryResolveAgentInterventionBySource(params),
    });

  setInterventionDraft = (toolMessageId: string, draft: Record<string, unknown>): void =>
    setInterventionDraft(this.#get, toolMessageId, draft);

  setInterventionAnswers = async (
    toolMessageId: string,
    answers: Record<string, unknown>,
    context?: OptimisticUpdateContext,
  ): Promise<void> => setInterventionAnswers(this.#get, toolMessageId, answers, context);

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
    const rollbackLocalDecision = this.#interventions.applyLocalDecision(
      [messageId],
      { rejectedReason: reason, status: 'rejected' },
      optimisticContext,
    );
    const shouldUseGatewayResume = await resolveGatewayResume(
      effectiveContext,
      [messageId],
      this.#get,
    );

    const toolContent = !!reason
      ? `User reject this tool calling with reason: ${reason}`
      : 'User reject this tool calling without reason';
    const requestMetadata = getRequestMetadataFromMessageChain(this.#get, messageId);

    if (shouldUseGatewayResume) {
      const toolCallId = toolMessage.tool_call_id;
      if (!toolCallId) {
        console.warn(
          '[rejectToolCalling][server] tool message missing tool_call_id; skipping resume',
        );
        rollbackLocalDecision();
        completeOperation(operationId);
        return;
      }
      const pausedOpIds = getRunningServerOps(this.#get, effectiveContext).map((op) => op.id);
      try {
        const sourceResolution = await this.tryResolveAgentInterventionBySource({
          action: { reason, type: 'reject_continue' },
          context: effectiveContext,
          toolMessageIds: [messageId],
        });
        if (discardAlreadyResolvedSource(this.#get, sourceResolution, operationId)) return;

        if (
          sourceResolution.handled ||
          (await resolveConfiguredGatewayResume(effectiveContext, this.#get))
        ) {
          // Park → resume: the new gateway op continues the run paused on this tool.
          emitRunResumed(this.#get, effectiveContext, {
            operationId,
            parentMessageId: messageId,
            runtimeType: 'gateway',
          });
          if (sourceResolution.handled) {
            if (sourceResolution.execution) {
              await this.#get().executeGatewayAgent({
                context: effectiveContext,
                message: '',
                metadata: requestMetadata,
                parentMessageId: messageId,
                precreatedResult: sourceResolution.execution,
              });
            }
          } else {
            await this.#get().executeGatewayAgent({
              context: effectiveContext,
              message: '',
              metadata: requestMetadata,
              parentMessageId: messageId,
              resumeApproval: {
                decision: 'rejected_continue',
                parentMessageId: messageId,
                rejectionReason: reason,
                toolCallId,
              },
            });
          }
          writeTopicStatus(this.#get, effectiveContext, 'active');
          completeOpsById(this.#get, pausedOpIds);
          completeOperation(operationId);
          return;
        }
      } catch (error) {
        const err = error as Error;
        console.error('[rejectToolCalling][server] Gateway resume failed:', err);
        rollbackLocalDecision();
        this.#get().failOperation(operationId, {
          type: 'rejectToolCalling',
          message: err.message || 'Unknown error',
        });
        throw error;
      }
    }

    writeTopicStatus(this.#get, effectiveContext, 'active');
    await this.#interventions.settleAfter([messageId], async () => {
      await this.#get().optimisticUpdateMessagePlugin(
        toolMessage.id,
        { intervention: { rejectedReason: reason, status: 'rejected' } },
        optimisticContext,
      );
      await this.#get().optimisticUpdateMessageContent(
        messageId,
        toolContent,
        undefined,
        optimisticContext,
      );
    });

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

    // Server-mode: start a **new** Gateway op with `decision='rejected_continue'`.
    // Server persists the rejection on the target tool message and resumes
    // the LLM loop with the rejection content surfaced as user feedback.
    // Skip the client-mode `rejectToolCalling` chain below — that would fire
    // a duplicate halting `reject` before this continue signal.
    const rollbackLocalDecision = this.#interventions.applyLocalDecision(
      [messageId],
      { rejectedReason: reason, status: 'rejected' },
      { context: effectiveContext },
    );
    if (await resolveGatewayResume(effectiveContext, [messageId], this.#get)) {
      const requestMetadata = getRequestMetadataFromMessageChain(this.#get, messageId);
      const toolCallId = toolMessage.tool_call_id;
      if (!toolCallId) {
        console.warn(
          '[rejectAndContinueToolCalling][server] tool message missing tool_call_id; skipping resume',
        );
        rollbackLocalDecision();
        return;
      }

      const pausedOpIds = getRunningServerOps(this.#get, effectiveContext).map((op) => op.id);
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

      try {
        const sourceResolution = await this.tryResolveAgentInterventionBySource({
          action: { reason, type: 'reject_continue' },
          context: effectiveContext,
          toolMessageIds: [messageId],
        });
        if (discardAlreadyResolvedSource(this.#get, sourceResolution, operationId)) return;

        if (
          sourceResolution.handled ||
          (await resolveConfiguredGatewayResume(effectiveContext, this.#get))
        ) {
          // Park → resume: the new gateway op continues the run paused on this tool.
          emitRunResumed(this.#get, effectiveContext, {
            operationId,
            parentMessageId: messageId,
            runtimeType: 'gateway',
          });
          if (sourceResolution.handled) {
            if (sourceResolution.execution) {
              await this.#get().executeGatewayAgent({
                context: effectiveContext,
                message: '',
                metadata: requestMetadata,
                parentMessageId: messageId,
                precreatedResult: sourceResolution.execution,
              });
            }
          } else {
            await this.#get().executeGatewayAgent({
              context: effectiveContext,
              message: '',
              metadata: requestMetadata,
              parentMessageId: messageId,
              resumeApproval: {
                decision: 'rejected_continue',
                parentMessageId: messageId,
                rejectionReason: reason,
                toolCallId,
              },
            });
          }
          writeTopicStatus(this.#get, effectiveContext, 'active');
          completeOpsById(this.#get, pausedOpIds);
          completeOperation(operationId);
          return;
        }
        completeOperation(operationId);
      } catch (error) {
        const err = error as Error;
        console.error('[rejectAndContinueToolCalling][server] Gateway resume failed:', err);
        rollbackLocalDecision();
        this.#get().failOperation(operationId, {
          type: 'rejectToolCalling',
          message: err.message || 'Unknown error',
        });
        throw error;
      }
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

    // Park → resume: this local op continues the run paused on the rejected tool.
    emitRunResumed(this.#get, effectiveContext, {
      operationId,
      parentMessageId: messageId,
      runtimeType: 'client',
    });

    // Get current messages for state construction using context
    const chatKey = messageMapKey({ agentId, topicId, threadId, scope });
    const currentMessages = await readClientRunMessages(this.#get, effectiveContext, chatKey);
    const requestMetadata = getRequestMetadataFromMessageChain(
      this.#get,
      messageId,
      currentMessages,
    );

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
        metadata: requestMetadata,
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
