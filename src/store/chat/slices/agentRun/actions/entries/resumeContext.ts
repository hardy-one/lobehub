import {
  type ChatTopicStatus,
  type ConversationContext,
  type MessageMetadata,
  type UIChatMessage,
} from '@lobechat/types';
import { toast } from '@lobehub/ui';
import { t } from 'i18next';

import { type ResolveAgentInterventionBySourceResult } from '@/services/aiAgent';
import { type AgentRuntimeType } from '@/store/chat/slices/agentRun/actions/dispatch/agentDispatcher';
import { dbMessageSelectors } from '@/store/chat/slices/message/selectors';
import { operationSelectors } from '@/store/chat/slices/operation/selectors';
import type { Operation } from '@/store/chat/slices/operation/types';
import { type ChatStore } from '@/store/chat/store';

import { buildRunLifecycle } from '../lifecycle/buildRunLifecycle';
import { type RunScope } from '../lifecycle/types';

export const canonicalizeResolutionPayload = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalizeResolutionPayload);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalizeResolutionPayload(child)]),
    );
  }
  return value;
};

export const toAgentInterventionAnswerResult = (
  value: Record<string, unknown>,
): Record<string, string | string[]> | undefined => {
  const entries = Object.entries(value);
  if (
    entries.length === 0 ||
    entries.some(
      ([, answer]) =>
        typeof answer !== 'string' &&
        !(Array.isArray(answer) && answer.every((item) => typeof item === 'string')),
    )
  ) {
    return;
  }
  return Object.fromEntries(entries) as Record<string, string | string[]>;
};

/**
 * Return running (non-aborting) `execServerAgentRuntime` ops in the given
 * context. Used only to snapshot paused ops before starting a resume op
 * so we can retire them if the server-side `agent_runtime_end` signal is
 * delayed or missing — see `completeOpsById`. In steady state with the
 * coordinator fix active, this returns an empty list by the time approve
 * runs because the server already completed the op.
 */
export const getRunningServerOps = (get: () => ChatStore, context: ConversationContext) => {
  const { agentId, groupId, scope, subAgentId, topicId, threadId } = context;
  if (!agentId) return [];
  const ops = operationSelectors.getOperationsByContext({
    agentId,
    groupId,
    scope,
    subAgentId,
    threadId: threadId ?? null,
    topicId: topicId ?? null,
  })(get());
  return ops.filter(
    (op) =>
      op.type === 'execServerAgentRuntime' &&
      op.status === 'running' &&
      !op.metadata?.isAborting &&
      !(groupId && isLiveGatewayOp(get, op)),
  );
};

/**
 * Whether an op's gateway stream is still open. In a group chat that is the
 * supervisor waiting on its members (e.g. a member parked on the approval
 * being resolved): it is not paused, it will stream the members' continuation
 * and its own closing, and retiring it would drop both from the screen.
 */
const isLiveGatewayOp = (get: () => ChatStore, op: Operation) => {
  const serverOperationId = op.metadata?.serverOperationId;
  if (!serverOperationId) return false;
  const status = get().gatewayConnections[serverOperationId]?.status;
  return !!status && status !== 'disconnected';
};

export const resolveHeteroInterventionExecutionOperation = (
  get: () => ChatStore,
  initialOperationId: string,
): { operation?: Operation; operationId: string } => {
  const operations: ChatStore['operations'] = get().operations;
  const visited = new Set<string>();
  let currentOperationId: string | undefined = initialOperationId;
  let lastResolved: { operation?: Operation; operationId: string } | undefined;

  while (currentOperationId && !visited.has(currentOperationId)) {
    visited.add(currentOperationId);
    const operation: Operation | undefined = operations[currentOperationId];
    lastResolved = { operation, operationId: currentOperationId };

    if (!operation) break;

    // `sendMessage` is the tree root, but it does not own the AskUser bridge.
    // Stop at the runtime execution node that produced this intervention.
    if (
      operation.type === 'execHeterogeneousAgent' ||
      operation.type === 'execServerAgentRuntime'
    ) {
      return { operation, operationId: currentOperationId };
    }

    currentOperationId = operation.parentOperationId;
  }

  return lastResolved ?? { operationId: initialOperationId };
};

/**
 * Local tool-interaction resumes are continuations of the original request.
 * Preserve the request trigger so downstream chat requests keep the same
 * headers after a human-intervention pause.
 */
export const getRequestMetadataFromMessageChain = (
  get: () => ChatStore,
  anchorMessageId: string,
  fallbackMessages: UIChatMessage[] = [],
): Pick<MessageMetadata, 'trigger'> | undefined => {
  const messagesById = new Map<string, UIChatMessage>();
  const addMessages = (messages: UIChatMessage[]) => {
    for (const message of messages) {
      if (!messagesById.has(message.id)) messagesById.set(message.id, message);
    }
  };

  for (const messages of Object.values(get().dbMessagesMap)) {
    addMessages(messages);
  }
  addMessages(fallbackMessages);

  const visitedIds = new Set<string>();
  let currentMessageId: string | undefined = anchorMessageId;

  while (currentMessageId && !visitedIds.has(currentMessageId)) {
    visitedIds.add(currentMessageId);

    const message = messagesById.get(currentMessageId);
    if (!message) return;

    const trigger = message.metadata?.trigger;
    if (trigger) return { trigger };

    currentMessageId = message.parentId;
  }
};

/**
 * Parent for the synthetic user turn that answers / skips a tool interaction.
 *
 * Anchor it on the assistant that requested the interaction — the tool
 * message's own parent — rather than leaving it null. A null parent makes the
 * turn a SECOND root of the topic, which `conversation-flow`'s doctor reports
 * as `segment-split`: the reader still shows it (roots are flattened in
 * order), but it starts a fresh parent chain, so anything walking the tree
 * (branch resolution, chain-based context assembly) loses the history before
 * it.
 *
 * Deliberately not the tool message itself: `canAnchor` in the doctor's
 * repair rule never treats a tool row as a spine tail, and this mirrors it so
 * the write side and the repair side agree on the same shape.
 */
export const interactionTurnParentId = (toolMessage: UIChatMessage): string | undefined =>
  toolMessage.parentId ?? undefined;

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
export const completeOpsById = (get: () => ChatStore, opIds: readonly string[]): void => {
  const { completeOperation } = get();
  for (const id of opIds) completeOperation(id);
};

/**
 * A durable source that reports `already_resolved` lost the first-winner
 * claim. `tryResolveAgentInterventionBySource` has already refreshed the
 * authoritative messages, so callers must not publish a resumed lifecycle,
 * execute, mark the topic active, or retire the actual paused operation.
 *
 * Actions that created an interim local operation before probing the source
 * still need to retire that temporary loading marker. Cancel it instead of
 * completing it so the losing action is never represented as a successful
 * resume.
 */
export const discardAlreadyResolvedSource = (
  get: () => ChatStore,
  result: ResolveAgentInterventionBySourceResult,
  interimOperationId?: string,
): boolean => {
  if (!result.handled || result.state !== 'already_resolved') return false;

  if (interimOperationId) {
    get().cancelOperation(interimOperationId, 'Intervention already resolved');
  }
  return true;
};

export const discardSettledHeteroQuestion = (get: () => ChatStore, id: string): boolean => {
  const intervention = dbMessageSelectors.getDbMessageById(id)(get())?.pluginIntervention;
  if (!intervention || intervention.status === 'pending') return false;
  if (intervention.status === 'aborted') {
    toast.info(t('tool.intervention.toolEnded', { ns: 'chat' }));
  }
  return true;
};

export const writeTopicStatus = (
  get: () => ChatStore,
  context: ConversationContext,
  status: ChatTopicStatus,
  force?: boolean,
) => {
  // A share visitor's topic belongs to the creator; the owner-scoped topic
  // write would be rejected, and the share page has no topic status UI.
  if (!context.topicId || context.agentShareId) return;

  const topicScope =
    context.scope === 'group' || context.scope === 'group_agent' ? context.scope : undefined;

  const statusWrite = get().updateTopicStatus?.({
    agentId: context.agentId,
    groupId: context.groupId,
    ...(topicScope ? { scope: topicScope } : {}),
    force,
    status,
    topicId: context.topicId,
  });

  void statusWrite?.catch((error) => {
    console.error('[conversationControl] updateTopicStatus failed:', error);
  });
};

/**
 * Broadcast that a parked run is resuming under a NEW operation. The resume
 * entries (approve / reject / reject-continue / submit / skip) call this at
 * dispatch so the park → resume transition flows through the unified run
 * lifecycle's `onRunResumed` seam instead of being invisible to it.
 *
 * Behavior-neutral: fires no terminal side effects and mutates no store state
 * (see `buildRunLifecycle.onRunResumed`). `buildRunLifecycle` is a pure factory,
 * so constructing a throwaway instance here purely to broadcast the resume is
 * cheap and side-effect-free; `[6]` AgentRunner is where the lifecycle becomes a
 * single per-run instance threaded through dispatch.
 */
export const emitRunResumed = (
  get: () => ChatStore,
  context: ConversationContext,
  params: { operationId: string; parentMessageId: string; runtimeType: AgentRuntimeType },
) => {
  const { operationId, parentMessageId, runtimeType } = params;
  const runScope: RunScope = context.scope === 'sub_agent' ? 'sub_agent' : 'top_level';
  void buildRunLifecycle(get, {
    context,
    parentMessageId,
    parentMessageType: 'tool',
    runId: operationId,
    runScope,
    runtimeType,
  }).onRunResumed({
    context,
    operationId,
    resumedOperationId: operationId,
    runId: operationId,
    runScope,
    runtimeType,
  });
};

/**
 * Honor a Stop pressed during the optimistic-write window. Interim ops
 * (approve / submit / skip) are created synchronously, but their optimistic
 * updates await, so a Stop landing in that gap cancels the op via
 * `stopGenerating` → `cancelOperations`. Detect the cancelled/terminal op and
 * bail before starting the run instead of resurrecting a stopped conversation.
 * `cancelOperation` flips status but keeps the record, so a real Stop always
 * leaves the op present here. Mirrors regenerateUserMessage's preflight guard.
 */
export const wasInterimOpStopped = (get: () => ChatStore, operationId: string): boolean => {
  const op = get().operations[operationId];
  return !!op && op.status !== 'running';
};
