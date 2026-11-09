import { describe, expect, it, vi } from 'vitest';

import { AgentRuntime } from '../core/runtime';
import { callLlm } from '../executors/callLlm';
import type {
  AgentRuntimeHost,
  ContextBuilder,
  ContextBuildOutput,
  LLMAttemptOutput,
  LLMTransport,
  MessageTransport,
  StreamSink,
} from '../transport';
import type {
  Agent,
  AgentRuntimeContext,
  AgentState,
  InstructionExecutor,
} from '../types';

/**
 * Scheduling-level integration evidence for the compression-recovery contract,
 * driven through the REAL `AgentRuntime.step` + REAL `callLlm` executor with a
 * fake host/transport. These assert the M1/M3 outcomes that unit-level tests of
 * an executor or a runner alone cannot: seed ownership, call accounting and the
 * non-terminal hand-back across the runtime boundary.
 */

const createMessageTransport = (): MessageTransport => ({
  createAssistantMessage: vi.fn().mockResolvedValue({ id: 'assistant-new' }),
  createToolMessage: vi.fn(),
  deleteMessage: vi.fn().mockResolvedValue(undefined),
  findById: vi.fn().mockResolvedValue({ id: 'seed-1' }),
  findToolMessageIdByToolCallId: vi.fn(),
  getToolMessage: vi.fn(),
  query: vi.fn(),
  update: vi.fn().mockResolvedValue(undefined),
  updatePluginState: vi.fn(),
  updateToolIntervention: vi.fn(),
  updateToolMessage: vi.fn(),
});

const createStreamSink = (): StreamSink => ({
  publishChunk: vi.fn(),
  publishEvent: vi.fn().mockResolvedValue(undefined),
  publishError: vi.fn(),
});

const createAttemptOutput = (): LLMAttemptOutput => ({
  answerSalvagedFromReasoning: false,
  content: 'answer',
  contentParts: [],
  grounding: null,
  hasContentImages: false,
  hasReasoningImages: false,
  imageList: [],
  reasoningParts: [],
  thinkingContent: '',
  toolCalls: [],
  toolsCalling: [],
});

const createHost = (overrides: {
  context?: ContextBuilder;
  llm?: Partial<LLMTransport['retryPolicy']> & { runAttempt?: LLMTransport['runAttempt'] };
  messages?: MessageTransport;
  stream?: StreamSink;
} = {}): AgentRuntimeHost => {
  const messages = overrides.messages ?? createMessageTransport();
  const stream = overrides.stream ?? createStreamSink();
  const context: ContextBuilder =
    overrides.context ??
    ({
      build: vi.fn().mockResolvedValue({
        estimatedInputTokens: 10,
        messages: [{ content: 'hello', role: 'user' }],
        replayAssistantReasoning: false,
        resolvedTools: { enabledToolIds: [], manifestMap: {}, promptManifestMap: {}, sourceMap: {}, tools: [] },
      } satisfies ContextBuildOutput),
    } as ContextBuilder);

  const retryPolicy: LLMTransport['retryPolicy'] = {
    classifyError: overrides.llm?.classifyError ?? vi.fn().mockReturnValue({ kind: 'stop', message: 'failed' }),
    maxAttempts: overrides.llm?.maxAttempts ?? vi.fn().mockReturnValue(1),
    onError: vi.fn(),
    onRetry: vi.fn(),
    resolveRetryBudget: overrides.llm?.resolveRetryBudget ?? vi.fn().mockReturnValue(0),
    waitForRetry: vi.fn().mockResolvedValue(undefined),
  };

  const llm: LLMTransport = {
    createTrace: vi.fn().mockReturnValue({
      close: vi.fn(),
      onFirstChunk: vi.fn(),
      run: (task: () => Promise<unknown>) => task(),
    }),
    retryPolicy,
    runAttempt: overrides.llm?.runAttempt ?? vi.fn().mockResolvedValue({ ok: true, output: createAttemptOutput() }),
    stream: vi.fn(),
  };

  return {
    operation: { operationId: 'op-1', stepIndex: 0 },
    transports: { context, llm, messages, stream },
  };
};

/** A fake Brain that plans only the phases this test drives. */
const createAgent = (): Agent =>
  ({
    executors: {},
    runner: async (context: AgentRuntimeContext, state: AgentState) => {
      switch (context.phase) {
        case 'user_input': {
          return {
            payload: {
              assistantMessageId: state.pendingAssistantMessageId,
              compressionThreshold: 100,
              messages: [{ content: 'hello', role: 'user' }],
              model: 'gpt-4',
              provider: 'openai',
              tools: [],
            },
            type: 'call_llm' as const,
          };
        }
        default: {
          return { reason: 'completed', reasonDetail: 'done', type: 'finish' as const };
        }
      }
    },
    tools: {},
  }) as unknown as Agent;

const createState = (overrides: Partial<AgentState> = {}): AgentState =>
  AgentRuntime.createInitialState({ operationId: 'op-1', status: 'running', ...overrides });

const buildRuntime = (host: AgentRuntimeHost) => {
  const executors = { call_llm: callLlm(host) } as Partial<Record<string, InstructionExecutor>>;
  return new AgentRuntime(createAgent(), { executors, operationId: 'op-1' });
};

const context = (): AgentRuntimeContext => ({
  payload: {},
  phase: 'user_input',
  session: { messageCount: 1, sessionId: 'op-1', status: 'idle', stepCount: 0 },
});

describe('compression recovery scheduling (real runtime.step + callLlm)', () => {
  it('pre-send overflow: no send, seed kept, llmCalls not incremented, hands to context_overflow', async () => {
    const host = createHost({
      context: {
        build: vi.fn().mockResolvedValue({
          estimatedInputTokens: 10_000, // over the 100 threshold
          messages: [{ content: 'hello', role: 'user' }],
          replayAssistantReasoning: false,
          resolvedTools: { enabledToolIds: [], manifestMap: {}, promptManifestMap: {}, sourceMap: {}, tools: [] },
        } satisfies ContextBuildOutput),
      } as ContextBuilder,
    });
    const runtime = buildRuntime(host);
    const state = createState({ pendingAssistantMessageId: 'seed-1' });

    const result = await runtime.step(state, context());

    expect(result.nextContext?.phase).toBe('context_overflow');
    expect(host.transports.llm.runAttempt).not.toHaveBeenCalled();
    expect(host.transports.messages.createAssistantMessage).not.toHaveBeenCalled();
    expect(result.newState.llmCalls).toBe(0);
    // Seed preserved for the compressed retry.
    expect(result.newState.pendingAssistantMessageId).toBe('seed-1');
    expect(result.newState.status).toBe('running');
  });

  it('provider window overflow (zero output): recovers to context_overflow, counts the attempt, keeps seed', async () => {
    const error = Object.assign(new Error('maximum context length is 8192 tokens'), {
      errorType: 'ExceededContextWindow',
    });
    const host = createHost({
      llm: {
        classifyError: vi.fn().mockReturnValue({ code: 'ExceededContextWindow', kind: 'stop', message: error.message }),
        maxAttempts: vi.fn().mockReturnValue(1),
        runAttempt: vi.fn().mockResolvedValue({ error, ok: false }),
      },
    });
    const runtime = buildRuntime(host);
    const state = createState({ pendingAssistantMessageId: 'seed-1' });

    const result = await runtime.step(state, context());

    expect(result.nextContext?.phase).toBe('context_overflow');
    expect(host.transports.llm.runAttempt).toHaveBeenCalledTimes(1);
    // The attempt is counted; the seed row is owned (not deleted) for reuse.
    expect(result.newState.llmCalls).toBe(1);
    expect(host.transports.messages.deleteMessage).not.toHaveBeenCalled();
    expect(result.newState.pendingAssistantMessageId).toBe('seed-1');
    expect(result.newState.status).toBe('running');
  });

  it('provider window overflow on a NEW row: deletes the empty row and closes the stream', async () => {
    const error = Object.assign(new Error('too many input tokens'), {
      errorType: 'ExceededContextWindow',
    });
    const messages = createMessageTransport();
    const stream = createStreamSink();
    const host = createHost({
      messages,
      stream,
      llm: {
        classifyError: vi.fn().mockReturnValue({ code: 'ExceededContextWindow', kind: 'stop', message: error.message }),
        maxAttempts: vi.fn().mockReturnValue(1),
        runAttempt: vi.fn().mockResolvedValue({ error, ok: false }),
      },
    });
    const runtime = buildRuntime(host);
    const state = createState();

    const result = await runtime.step(state, context());

    expect(result.nextContext?.phase).toBe('context_overflow');
    expect(messages.deleteMessage).toHaveBeenCalledWith('assistant-new');
    expect(stream.publishEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'stream_end' }));
  });

  it('token rate-limit (classifier kind retry): not hijacked, ends as a normal error terminal', async () => {
    const error = new Error('too many tokens, rate limit exceeded');
    const host = createHost({
      llm: {
        classifyError: vi.fn().mockReturnValue({ code: 'RateLimitExceeded', kind: 'retry', message: error.message }),
        maxAttempts: vi.fn().mockReturnValue(1),
        resolveRetryBudget: vi.fn().mockReturnValue(0),
        runAttempt: vi.fn().mockResolvedValue({ error, ok: false }),
      },
    });
    const runtime = buildRuntime(host);
    const state = createState();

    const result = await runtime.step(state, context());

    expect(result.newState.status).toBe('error');
    expect(result.nextContext).toBeUndefined();
  });
});
