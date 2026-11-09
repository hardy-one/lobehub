import type {
  AgentRuntimeHost,
  ContextBuildOutput,
  LLMAttemptOutput,
  LLMRetryPolicy,
  LLMTrace,
  LLMTransport,
  RuntimeMessageRef,
} from '../transport';
import type {
  AgentEvent,
  AgentInstruction,
  AgentState,
  CallLLMPayload,
  InstructionExecutionResult,
  InstructionExecutor,
} from '../types';
import { withLlmAttemptCount } from '../utils/llmCalls';
import { isContextOverflowError } from '../utils/llmErrorClassifier';
import { getLLMRetryDelayMs, shouldRetryLLM } from '../utils/runtimeRetry';
import { finalizeCallLlmTurn, persistInterruptedCallLlmResult } from './callLlmFinalizer';

const CONVERSATION_PARENT_MISSING_ERROR_TYPE = 'ConversationParentMissing';

interface LLMCallTransport {
  retryPolicy: LLMRetryPolicy;
  runAttempt: NonNullable<LLMTransport['runAttempt']>;
}

interface PreparedCallLlmInput {
  assistantMessageId: string;
  /** Whether the assistant row predated this attempt (reused, not created here). */
  assistantMessageIdPreExisted?: boolean;
  context: ContextBuildOutput;
  /** Raw input tokens of the assembled prompt, for the overflow hand-back. */
  estimatedTokens?: number;
  model: string;
  parentId?: string;
  provider: string;
  state: AgentState;
  stepLabel?: string;
}

const requireLLMCallTransport = (host: AgentRuntimeHost) => {
  const llm = host.transports.llm;
  if (!llm?.runAttempt) {
    throw new Error('LLMTransport.runAttempt is required for call_llm executor');
  }
  if (!llm.retryPolicy) {
    throw new Error('LLMTransport.retryPolicy is required for call_llm executor');
  }
  return llm as NonNullable<AgentRuntimeHost['transports']['llm']> & LLMCallTransport;
};

const waitForRetry = (delayMs: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });

const isOperationInterrupted = async (host: AgentRuntimeHost) => {
  const operationStore = host.transports.operationStore;
  if (!operationStore?.loadState) return false;

  try {
    const latestState = await operationStore.loadState(host.operation.operationId);
    return latestState?.status === 'interrupted';
  } catch (error) {
    console.error('[call_llm] Failed to load operation state for retry guard:', error);
    return false;
  }
};

const runWithTrace = <T>(trace: LLMTrace | undefined, task: () => Promise<T>) =>
  trace ? trace.run(task) : task();

/** Whether an attempt produced any output (content/reasoning/tool calls). */
const hasPartialOutput = (output?: LLMAttemptOutput): boolean =>
  Boolean(
    output &&
      (output.content ||
        output.thinkingContent ||
        (output.toolCalls?.length ?? 0) > 0 ||
        (output.toolsCalling?.length ?? 0) > 0),
  );

interface OverflowResultParams {
  /** Assistant id involved, when the call reached message creation. */
  assistantMessageId?: string;
  /** Provider attempts made before the overflow (0 for a pre-send abort). */
  attempts?: number;
  /** Whether a resume-seeded placeholder was used (owns the row, don't delete). */
  claimedSeed?: boolean;
  /** Close the stream started for this attempt. */
  closeStream?: boolean;
  /** Delete the empty assistant row this attempt created (new-row case only). */
  deleteAssistantRow?: boolean;
  /** Whether the request was actually sent to the provider. */
  sent: boolean;
}

/**
 * Hand control back to the agent to compress, as a NON-terminal step (status
 * stays running, nextContext.phase = context_overflow) so the runtime loop
 * continues into recovery on both hosts. Performs message/stream ownership
 * cleanup for a provider-side overflow that was already sent.
 */
const buildContextOverflowResult = async (
  host: AgentRuntimeHost,
  state: AgentState,
  tokenCount: number,
  params: OverflowResultParams,
): Promise<InstructionExecutionResult> => {
  if (params.closeStream) {
    try {
      await host.transports.stream.publishEvent({
        data: { reason: 'context_overflow' },
        stepIndex: host.operation.stepIndex,
        type: 'stream_end',
      });
    } catch (error) {
      console.warn('[call_llm] Failed to close stream on overflow:', error);
    }
  }
  if (params.deleteAssistantRow && params.assistantMessageId) {
    try {
      await host.transports.messages.deleteMessage(params.assistantMessageId);
    } catch (error) {
      console.warn('[call_llm] Failed to clean up overflow assistant row:', error);
    }
  }

  const newState = structuredClone(state);
  newState.lastModified = new Date().toISOString();
  return {
    events: [],
    llmExecution: {
      sent: params.sent,
      ...(params.attempts !== undefined && { attempts: params.attempts }),
      ...(params.assistantMessageId && { assistantMessageId: params.assistantMessageId }),
      ...(params.claimedSeed !== undefined && { claimedSeed: params.claimedSeed }),
      recovery: 'context_overflow',
    },
    newState,
    nextContext: {
      payload: { tokenCount },
      phase: 'context_overflow',
      session: {
        messageCount: newState.messages.length,
        sessionId: host.operation.operationId,
        status: 'running',
        stepCount: newState.stepCount,
      },
    },
  };
};

const executePreparedCall = async (
  host: AgentRuntimeHost,
  llm: LLMCallTransport,
  prepared: PreparedCallLlmInput,
  trace?: LLMTrace,
) => {
  const events: AgentEvent[] = [];
  const { retryPolicy } = llm;
  const maxAttempts = retryPolicy.maxAttempts(prepared.provider);
  let errorHandled = false;
  let lastOutput: LLMAttemptOutput | undefined;
  let terminalError: unknown;
  let attemptsMade = 0;

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const execution = await runWithTrace(trace, () =>
        llm.runAttempt({
          assistantMessageId: prepared.assistantMessageId,
          attempt,
          context: prepared.context,
          events,
          maxAttempts,
          model: prepared.model,
          onFirstChunk: trace?.onFirstChunk.bind(trace),
          provider: prepared.provider,
          state: prepared.state,
        }),
      );
      lastOutput = execution.output;
      attemptsMade = attempt;

      if (execution.ok) {
        const finalized = await finalizeCallLlmTurn({
          assistantMessageId: prepared.assistantMessageId,
          attempts: attemptsMade,
          events,
          host,
          model: prepared.model,
          output: execution.output,
          provider: prepared.provider,
          recordResult: trace?.recordResult?.bind(trace),
          shouldReplayAssistantReasoning: prepared.context.replayAssistantReasoning,
          state: prepared.state,
          stepLabel: prepared.stepLabel,
        });
        return {
          ...finalized,
          llmExecution: {
            sent: true,
            attempts: attemptsMade,
            assistantMessageId: prepared.assistantMessageId,
            claimedSeed: Boolean(prepared.assistantMessageIdPreExisted),
          },
        };
      }

      const { error } = execution;
      const classified = retryPolicy.classifyError(error);
      const retryBudget = retryPolicy.resolveRetryBudget(prepared.provider, error);
      let interrupted = await isOperationInterrupted(host);

      // Recover from a context-window overflow, using the structured error
      // identity (`ExceededContextWindow`) first — so codes/labels the shared
      // classifier already recognises (e.g. "conversation is too long",
      // "too many input tokens") are covered — with the message-keyword check as
      // a last resort. Require `kind === 'stop'` so token rate-limits that the
      // classifier marked retryable keep their normal backoff. Only a request
      // that produced no output is auto-recovered; a partial stream is saved and
      // the run fails normally.
      const windowErrorType = (error as { errorType?: unknown } | undefined)?.errorType;
      const recoverableOverflow =
        !interrupted &&
        classified.kind === 'stop' &&
        (windowErrorType === 'ExceededContextWindow' ||
          classified.code === 'ExceededContextWindow' ||
          isContextOverflowError(error));
      if (recoverableOverflow && !hasPartialOutput(lastOutput)) {
        return buildContextOverflowResult(host, prepared.state, prepared.estimatedTokens ?? 0, {
          attempts: attemptsMade,
          assistantMessageId: prepared.assistantMessageId,
          claimedSeed: Boolean(prepared.assistantMessageIdPreExisted),
          deleteAssistantRow: !prepared.assistantMessageIdPreExisted,
          closeStream: true,
          sent: true,
        });
      }

      if (!interrupted && shouldRetryLLM(classified.kind, attempt, retryBudget)) {
        const delayMs = getLLMRetryDelayMs(attempt);
        const retryEvent: AgentEvent = {
          data: {
            attempt: attempt + 1,
            delayMs,
            errorType: classified.code,
            kind: classified.kind,
            maxAttempts,
          },
          type: 'stream_retry',
        };
        events.push(retryEvent);

        await retryPolicy.onRetry?.({
          attempt,
          delayMs,
          error: classified,
          maxAttempts,
        });
        await host.transports.stream.publishEvent({
          data: retryEvent.data,
          stepIndex: host.operation.stepIndex,
          type: 'stream_retry',
        });
        await (retryPolicy.waitForRetry ?? waitForRetry)(delayMs);

        interrupted = await isOperationInterrupted(host);
        if (!interrupted) continue;
      }

      errorHandled = true;
      if (interrupted) {
        await persistInterruptedCallLlmResult({
          assistantMessageId: prepared.assistantMessageId,
          host,
          output: execution.output,
        });
      }
      await runWithTrace(trace, async () => {
        await retryPolicy.onError?.({
          error,
          events,
          interrupted,
          output: execution.output,
          retryBudget,
        });
      });
      throw withLlmAttemptCount(error, attemptsMade);
    }

    throw withLlmAttemptCount(
      new Error('LLM execution retry loop exited unexpectedly'),
      attemptsMade,
    );
  } catch (error) {
    terminalError = error;
    if (!errorHandled) {
      const interrupted = await isOperationInterrupted(host);
      if (interrupted && lastOutput) {
        await persistInterruptedCallLlmResult({
          assistantMessageId: prepared.assistantMessageId,
          host,
          output: lastOutput,
        });
      }
      await runWithTrace(trace, async () => {
        await retryPolicy.onError?.({
          error,
          events,
          interrupted,
          output: lastOutput,
        });
      });
    }
    throw withLlmAttemptCount(error, attemptsMade);
  } finally {
    await trace?.close(terminalError);
  }
};

const requireContextBuilder = (host: AgentRuntimeHost) => {
  const context = host.transports.context;
  if (!context) {
    throw new Error('ContextBuilder is required for call_llm executor');
  }
  return context;
};

const assertPreparedCallContext = (
  prepared: Pick<PreparedCallLlmInput, 'context' | 'model' | 'provider' | 'state'>,
  stepIndex: number,
) => {
  if (!prepared.context.resolvedTools) {
    throw new Error('Resolved tools are required for call_llm');
  }

  const messages = prepared.context.messages as Array<{ role?: string }>;
  if (!messages.some((message) => message.role !== 'system')) {
    throw new Error(
      `call_llm produced no non-system messages for ${prepared.provider}/${prepared.model} ` +
        `(topic=${prepared.state.origin?.topicId ?? 'n/a'}, step=${stepIndex}); refusing to dispatch`,
    );
  }
};

const createConversationParentMissingError = (parentId: string) => {
  const error = new Error(
    `Conversation parent message ${parentId} no longer exists. It was likely deleted while the operation was running.`,
  );
  Object.assign(error, {
    errorType: CONVERSATION_PARENT_MISSING_ERROR_TYPE,
    parentId,
  });
  return error;
};

const formatErrorEventData = (error: Error & { errorType?: unknown }, phase: string) => ({
  error: error.message,
  errorType: typeof error.errorType === 'string' ? error.errorType : error.name,
  phase,
});

const pickSeedField = (source: object, key: string) => {
  const value = (source as Record<string, unknown>)[key];
  return value === undefined ? undefined : value;
};

const buildAssistantMessageSeed = (
  assistantMessage: { id: string },
  seed: object = assistantMessage,
) => ({
  id: assistantMessage.id,
  ...(pickSeedField(seed, 'agentId') !== undefined && {
    agentId: pickSeedField(seed, 'agentId'),
  }),
  ...(pickSeedField(seed, 'groupId') !== undefined && {
    groupId: pickSeedField(seed, 'groupId'),
  }),
  ...(pickSeedField(seed, 'model') !== undefined && { model: pickSeedField(seed, 'model') }),
  ...(pickSeedField(seed, 'parentId') !== undefined && {
    parentId: pickSeedField(seed, 'parentId'),
  }),
  ...(pickSeedField(seed, 'provider') !== undefined && {
    provider: pickSeedField(seed, 'provider'),
  }),
  ...(pickSeedField(seed, 'role') !== undefined && { role: pickSeedField(seed, 'role') }),
  ...(pickSeedField(seed, 'threadId') !== undefined && {
    threadId: pickSeedField(seed, 'threadId'),
  }),
  ...(pickSeedField(seed, 'topicId') !== undefined && {
    topicId: pickSeedField(seed, 'topicId'),
  }),
});

/**
 * A steer message the server joined into the running turn is created after
 * the step's `step_start` snapshot, so the client has no copy of it. Ship it
 * with `stream_start` (the preflight read already loaded it) so the client
 * shows it above this step's reply instead of only after the step ends.
 */
const buildSteerParentSeed = (parent: RuntimeMessageRef | undefined) => {
  if (parent?.role !== 'user' || !parent.metadata?.steer) return;

  return {
    content: parent.content ?? '',
    id: parent.id,
    metadata: parent.metadata,
    parentId: parent.parentId ?? null,
    role: 'user' as const,
  };
};

/**
 * Package-owned `call_llm` executor entry point.
 *
 * The package prepares and finalizes the turn, including retry, interruption,
 * persistence, and state updates. The host-bound session retains provider
 * policy, model attempt execution, and tracing hooks.
 */
export const callLlm =
  (host: AgentRuntimeHost): InstructionExecutor =>
  async (instruction, state, runtimeContext) => {
    const { operation, transports } = host;
    const contextBuilder = requireContextBuilder(host);
    const llm = requireLLMCallTransport(host);
    const { payload } = instruction as Extract<AgentInstruction, { type: 'call_llm' }>;
    const llmPayload = payload as CallLLMPayload & {
      assistantMessageId?: string;
      parentMessageId?: string;
    };
    const model = llmPayload.model || state.modelRuntimeConfig?.model;
    const provider = llmPayload.provider || state.modelRuntimeConfig?.provider;

    if (!model || !provider) {
      throw new Error('Model and provider are required for call_llm instruction');
    }

    const parentId = llmPayload.parentId || llmPayload.parentMessageId;
    let parentMessage: RuntimeMessageRef | undefined;
    if (parentId) {
      parentMessage = await transports.messages.findById(parentId);
      if (!parentMessage) {
        const error = createConversationParentMissingError(parentId);
        await transports.stream.publishEvent({
          data: formatErrorEventData(error, 'parent_message_preflight'),
          stepIndex: operation.stepIndex,
          type: 'error',
        });
        throw error;
      }
    }

    const existingAssistantMessageId = llmPayload.assistantMessageId;
    // Pre-created placeholders (e.g. sendMessage creates the assistant row
    // before the operation exists) miss the creation-time provenance stamp —
    // merge it here so reused messages carry metadata.operationId too.
    // Best-effort: the stamp is only a tracing aid and must never turn a
    // normal send/resume into an LLM error before streaming starts.
    if (existingAssistantMessageId) {
      try {
        await transports.messages.update(existingAssistantMessageId, {
          metadata: { operationId: operation.operationId },
        });
      } catch (error) {
        console.warn('[call_llm] Failed to stamp operation id provenance:', error);
      }
    }
    // Assemble the exact prompt BEFORE creating the assistant row, so an
    // over-budget request can be abandoned (handed back as `context_overflow`)
    // without leaving an orphaned assistant message behind.
    const context = await contextBuilder
      .build({
        model,
        payload: llmPayload,
        provider,
        state,
      })
      .catch(async (error) => {
        await transports.stream.publishError?.({
          error,
          phase: 'llm_execution',
          stepIndex: operation.stepIndex,
        });
        throw error;
      });

    // Measure the assembled request — the only place where the full preamble
    // (system role, memory, skills, tool schemas) and the real provider message
    // shape are visible. Prefer the request-prep layer's estimate; when the
    // agent supplied a threshold and the prompt exceeds it, hand back a
    // non-terminal `context_overflow` step BEFORE the assistant row and
    // stream_start, so the agent can compress and retry and no row is orphaned.
    const estimatedTokens = context.estimatedInputTokens ?? 0;
    const compressionThreshold = (llmPayload as { compressionThreshold?: number })
      .compressionThreshold;
    if (compressionThreshold !== undefined && estimatedTokens > compressionThreshold) {
      // Prepared but not sent: no assistant row, no stream_start, no provider
      // call, seed not consumed. Hand back a non-terminal context_overflow step.
      return await buildContextOverflowResult(host, state, estimatedTokens, { sent: false });
    }

    const assistantMessage = existingAssistantMessageId
      ? { id: existingAssistantMessageId }
      : await transports.messages.createAssistantMessage(
          {
            agentId: (operation.agentId ?? state.origin?.agentId) as string,
            content: '',
            groupId: state.origin?.groupId ?? undefined,
            // Creation provenance (metadata.operationId): ties the row to the
            // operation that produced it so the id survives client reloads.
            metadata: { operationId: operation.operationId },
            model,
            parentId,
            provider,
            role: 'assistant',
            threadId: state.origin?.threadId,
            topicId: state.origin?.topicId,
          },
          {
            /**
             * Step retries must reuse the same assistant message, while multiple LLM
             * instructions in one step must keep independent messages.
             */
            idempotencyKey:
              `agent-runtime:${operation.operationId}:step:${operation.stepIndex}:` +
              `instruction:${runtimeContext?.instructionIndex ?? 0}:assistant`,
          },
        );

    const assistantMessageSeed = existingAssistantMessageId
      ? ((await transports.messages.findById(existingAssistantMessageId)) ?? assistantMessage)
      : assistantMessage;
    const stepLabel = (instruction as { stepLabel?: string }).stepLabel;
    const steerParentSeed = buildSteerParentSeed(parentMessage);

    await transports.stream.publishEvent({
      data: {
        assistantMessage: buildAssistantMessageSeed(assistantMessage, assistantMessageSeed),
        model,
        ...(steerParentSeed && { parentMessage: steerParentSeed }),
        provider,
        ...(stepLabel && { stepLabel }),
      },
      stepIndex: operation.stepIndex,
      type: 'stream_start',
    });

    try {
      const prepared: PreparedCallLlmInput = {
        assistantMessageId: assistantMessage.id,
        assistantMessageIdPreExisted: Boolean(existingAssistantMessageId),
        context,
        estimatedTokens,
        model,
        parentId,
        provider,
        state,
        stepLabel,
      };
      assertPreparedCallContext(prepared, operation.stepIndex);
      const trace = llm.createTrace?.({
        assistantMessageId: assistantMessage.id,
        context,
        conversationId: state.origin?.topicId,
        model,
        provider,
      });
      return await executePreparedCall(host, llm, prepared, trace);
    } catch (error) {
      await transports.stream.publishError?.({
        error,
        phase: 'llm_execution',
        stepIndex: operation.stepIndex,
      });
      throw error;
    }
  };
