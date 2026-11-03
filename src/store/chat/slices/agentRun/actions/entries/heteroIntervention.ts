import { type ConversationContext } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';
import {
  type AgentInterventionSourceAction,
  type ResolveAgentInterventionBySourceResult,
} from '@/services/aiAgent';
import { type OptimisticUpdateContext } from '@/store/chat/slices/message/actions/optimisticUpdate';
import { dbMessageSelectors } from '@/store/chat/slices/message/selectors';
import { type ChatStore } from '@/store/chat/store';

import { type createInterventionProjection } from './interventionProjection';
import { setInterventionAnswers } from './interventionState';
import {
  canonicalizeResolutionPayload,
  discardAlreadyResolvedSource,
  discardSettledHeteroQuestion,
  resolveHeteroInterventionExecutionOperation,
  toAgentInterventionAnswerResult,
} from './resumeContext';

type InterventionProjection = ReturnType<typeof createInterventionProjection>;

const toHeterogeneousSourceAction = (
  actionType: 'submit' | 'skip' | 'cancel',
  interactionKind: unknown,
  payload: Record<string, unknown>,
): AgentInterventionSourceAction | undefined => {
  if (actionType === 'skip') return { type: 'skip_interaction' };
  if (actionType === 'cancel') return { type: 'cancel_interaction' };

  if (interactionKind === 'question') {
    const result = toAgentInterventionAnswerResult(payload);
    return result ? { result, type: 'submit_answers' } : undefined;
  }
  if (interactionKind === 'permission' || interactionKind === 'plan') {
    const selected = Object.values(payload).flatMap((value) =>
      typeof value === 'string'
        ? [value]
        : Array.isArray(value)
          ? value.filter((item): item is string => typeof item === 'string')
          : [],
    );
    return selected.length === 1
      ? { optionId: selected[0], type: 'select_provider_option' }
      : undefined;
  }
};

interface SubmitHeteroInterventionParams {
  actionType: 'submit' | 'skip' | 'cancel';
  context?: ConversationContext;
  get: () => ChatStore;
  heteroResolutionRequestIds: Map<string, string>;
  interventions: InterventionProjection;
  payload?: Record<string, unknown>;
  toolMessageId: string;
  tryResolveAgentInterventionBySource: (params: {
    action: AgentInterventionSourceAction;
    context?: ConversationContext;
    toolMessageIds: string[];
  }) => Promise<ResolveAgentInterventionBySourceResult>;
}

/**
 * Resolve a heterogeneous-runtime intervention (CC AskUserQuestion, …).
 *
 * Why this action exists separately from `submitToolInteraction`:
 * - The CC subprocess is already running and blocked on an MCP call —
 *   we need to feed the answer back through the IPC bridge, not spawn
 *   a fresh `executeClientAgent` turn.
 * - Once the answer ships, CC's existing stream emits `tool_result` and
 *   keeps going on its own; no synthetic user message, no new op.
 *
 * The framework's intervention surface still drives the UI: we just
 * keep submissions `pending + resolving` until the producer echoes its ACK, so the
 * form stays visible and disabled across remounts without claiming success.
 *
 * `actionType`:
 *   - `'submit'` → ship `payload` as the answer
 *   - `'skip' | 'cancel'` → ship `cancelled: true` so the
 *     bridge resolves with `cancelReason` and CC sees an isError result
 *     (it'll fall back to plain-text questioning)
 */
export const submitHeteroIntervention = async ({
  actionType,
  context,
  get,
  heteroResolutionRequestIds,
  interventions,
  payload,
  toolMessageId,
  tryResolveAgentInterventionBySource,
}: SubmitHeteroInterventionParams): Promise<void> => {
  const toolMessage = dbMessageSelectors.getDbMessageById(toolMessageId)(get());
  if (!toolMessage) throw new Error('Question message is unavailable');
  if (discardSettledHeteroQuestion(get, toolMessageId)) return;

  const toolCallId = toolMessage.tool_call_id;
  if (!toolCallId) {
    throw new Error('Question has no tool call identity');
  }

  const effectiveContext: ConversationContext = context ?? {
    agentId: get().activeAgentId,
    topicId: get().activeTopicId,
    threadId: get().activeThreadId,
  };
  const originalIntervention = toolMessage.pluginIntervention;
  const interventionState = (
    toolMessage.pluginState as
      { heterogeneousIntervention?: { interactionKind?: unknown } } | undefined
  )?.heterogeneousIntervention;
  const sourceAction = toHeterogeneousSourceAction(
    actionType,
    interventionState?.interactionKind,
    payload ?? {},
  );

  // A persisted v2 card carries everything the server needs to locate and
  // authorize the intervention. Resolve it before consulting ephemeral
  // operation memory so refresh/cold-start submissions still reach the
  // durable first-winner claim. The message/runtime ids are locators only;
  // the source endpoint remains responsible for ACL and token authority.
  if (originalIntervention?.batchId && originalIntervention.operationId && sourceAction) {
    let sourceResolution: ResolveAgentInterventionBySourceResult;
    try {
      sourceResolution = await tryResolveAgentInterventionBySource({
        action: sourceAction,
        context: effectiveContext,
        toolMessageIds: [toolMessageId],
      });
    } catch (error) {
      if (discardSettledHeteroQuestion(get, toolMessageId)) return;
      if (await get().checkQuestionSubmission(toolMessageId, effectiveContext)) {
        discardSettledHeteroQuestion(get, toolMessageId);
        return;
      }
      throw error;
    }
    if (discardSettledHeteroQuestion(get, toolMessageId)) return;
    if (discardAlreadyResolvedSource(get, sourceResolution)) return;

    if (sourceResolution.handled) {
      const sourceOptimisticContext: OptimisticUpdateContext = { context: effectiveContext };
      interventions.dispatch(
        toolMessageId,
        { resolving: true, skipped: actionType === 'skip', status: 'pending' },
        sourceOptimisticContext,
      );
      if (actionType === 'submit') {
        await setInterventionAnswers(get, toolMessageId, payload ?? {}, sourceOptimisticContext);
      }
      return;
    }
  }

  // Walk up to the assistant that owns this tool. `messageOperationMap` is a
  // most-granular pointer, so it may reference a transient child op
  // (`reasoning`, `toolCalling`, ...), not the runtime execution that owns
  // the AskUser bridge. This memory-only lookup is deliberately deferred
  // until the durable path is unavailable or reports `handled: false`; it is
  // provenance for local desktop IPC / legacy fallback, never server auth.
  const { messageOperationMap } = get();
  const candidateOperationId =
    (toolMessage.parentId && messageOperationMap?.[toolMessage.parentId]) ??
    messageOperationMap?.[toolMessageId];

  if (!candidateOperationId) {
    if (await get().checkQuestionSubmission(toolMessageId, effectiveContext)) {
      discardSettledHeteroQuestion(get, toolMessageId);
      return;
    }
    throw new Error('Question runtime is unavailable');
  }

  // Resolve the runtime execution op before choosing IPC vs remote transport.
  // For local CC this is `execHeterogeneousAgent`; for gateway/device runs
  // this is `execServerAgentRuntime`.
  const { operation, operationId } = resolveHeteroInterventionExecutionOperation(
    get,
    candidateOperationId,
  );

  // A cold/GC'd run still uses the card's captured context, never the active tab.
  const operationAlive = !!operation;
  if (!operationAlive) {
    console.warn(
      '[submitHeteroIntervention] operation already gone, using card context:',
      operationId,
    );
  }
  const optimisticContext: OptimisticUpdateContext = operationAlive
    ? { operationId }
    : { context: effectiveContext };
  const isLocalDesktopHetero = operation?.type === 'execHeterogeneousAgent';

  // Both transports wait for the producer's result event. Local IPC delivery
  // does not prove that an already-ended bridge consumed the answer.
  interventions.dispatch(
    toolMessageId,
    { resolving: true, skipped: actionType === 'skip', status: 'pending' },
    optimisticContext,
  );
  if (actionType === 'submit') {
    await setInterventionAnswers(get, toolMessageId, payload ?? {}, optimisticContext);
  }
  if (discardSettledHeteroQuestion(get, toolMessageId)) return;

  // Forward the answer to the producer over the transport THIS op actually
  // ran on — read from the op itself, not re-derived from the current agent
  // config (which drifts if the user changed the execution target after
  // dispatch, or answers while a different agent is active).
  //
  // A local desktop CC run is an `execHeterogeneousAgent` op whose producer
  // lives in the Electron main → resolve the bridge over IPC. Anything else —
  // a gateway-dispatched remote sandbox/device run (`execServerAgentRuntime`),
  // or an op already GC'd after its waiting-for-human signal — is remote:
  // publish the answer via tRPC → Redis stream → the exec's long-poll →
  // `bridge.resolve()`. Local hetero ops stay `running` while CC is blocked on
  // the question, so they are never GC'd out from under this check; that makes
  // "not an alive execHeterogeneousAgent op" a safe signal for "remote".
  // Both paths are idempotent on an unknown / already-settled toolCallId.
  try {
    if (isLocalDesktopHetero) {
      // Dynamic import keeps `@/services/electron/*` out of non-Electron bundles.
      const { heterogeneousAgentService } = await import('@/services/electron/heterogeneousAgent');
      await heterogeneousAgentService.submitIntervention(
        actionType === 'submit'
          ? { operationId, result: payload ?? {}, toolCallId }
          : { cancelReason: 'user_cancelled', cancelled: true, operationId, toolCallId },
      );
    } else {
      // The producer long-polls the server operation's stream. A gateway run's
      // local op id is client-only, so an answer published under it never
      // reaches the producer.
      const remoteOperationId = operation?.metadata?.serverOperationId ?? operationId;
      const resolutionIntent = JSON.stringify(
        canonicalizeResolutionPayload({ actionType, payload: payload ?? {} }),
      );
      const resolutionKey = `${remoteOperationId}:${toolCallId}:${resolutionIntent}`;
      const resolutionRequestId =
        heteroResolutionRequestIds.get(resolutionKey) ?? globalThis.crypto.randomUUID();
      heteroResolutionRequestIds.set(resolutionKey, resolutionRequestId);
      await lambdaClient.aiAgent.submitHeteroIntervention.mutate(
        actionType === 'submit'
          ? {
              operationId: remoteOperationId,
              resolutionRequestId,
              result: payload ?? {},
              toolCallId,
            }
          : {
              cancelReason: 'user_cancelled',
              cancelled: true,
              operationId: remoteOperationId,
              resolutionRequestId,
              toolCallId,
            },
      );
    }
  } catch (err) {
    if (discardSettledHeteroQuestion(get, toolMessageId)) return;
    console.error('[submitHeteroIntervention] submitIntervention failed:', err);
    // Only the client-owned in-flight hint needs undoing. Writing pending
    // back to the server could overwrite a producer result racing this error.
    interventions.dispatch(
      toolMessageId,
      { resolving: false, skipped: originalIntervention?.skipped ?? false, status: 'pending' },
      optimisticContext,
    );
    if (await get().checkQuestionSubmission(toolMessageId, effectiveContext)) {
      discardSettledHeteroQuestion(get, toolMessageId);
      return;
    }
    throw err;
  }

  // Sidebar topic row was swapped to the `waitingForHuman` hand icon when
  // the intervention was raised; once the user submits/skips/cancels the
  // CC stream resumes so flip it back to `running`. The natural completion
  // (`runtime_end` → `writeTopicStatus('active')`) takes over from there.
  if (isLocalDesktopHetero && effectiveContext.topicId) {
    void get().updateTopicStatus?.({
      agentId: effectiveContext.agentId,
      groupId: effectiveContext.groupId,
      status: 'running',
      topicId: effectiveContext.topicId,
    });
  }
};
