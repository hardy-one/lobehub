import { describe, expect, it, vi } from 'vitest';

import { GeneralChatAgent } from '../agents/GeneralChatAgent';
import { AgentRuntime } from '../core/runtime';
import { callLlm } from '../executors/callLlm';
import { compressContext } from '../executors/compressContext';
import type {
  AgentRuntimeHost,
  ContextBuilder,
  ContextBuildOutput,
  LLMAttemptOutput,
  LLMTransport,
  MessageTransport,
  StreamSink,
} from '../transport';
import type { AgentRuntimeContext, AgentState, InstructionExecutor } from '../types';

/**
 * Full-loop scheduling evidence for the compression-recovery contract: the REAL
 * `GeneralChatAgent` planning + REAL `callLlm` (and, for the failure path, the
 * REAL `compressContext` executor) driven through the REAL `AgentRuntime.step`
 * loop with a fake host/provider/message store, iterating to a terminal state.
 */

const createAttemptOutput = (content = 'answer'): LLMAttemptOutput => ({
  answerSalvagedFromReasoning: false,
  content,
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

const createUsage = () => ({
  humanInteraction: { approvalRequests: 0, promptRequests: 0, selectRequests: 0, totalWaitingTimeMs: 0 },
  llm: { apiCalls: 0, processingTimeMs: 0, tokens: { input: 0, output: 0, total: 0 } },
  tools: { byTool: [], totalCalls: 0, totalTimeMs: 0 },
});
const createCost = () => ({
  calculatedAt: new Date().toISOString(),
  currency: 'USD',
  llm: { byModel: [], currency: 'USD', total: 0 },
  tools: { byTool: [], currency: 'USD', total: 0 },
  total: 0,
});

const createState = (overrides: Partial<AgentState> = {}): AgentState => ({
  cost: createCost(),
  createdAt: new Date().toISOString(),
  lastModified: new Date().toISOString(),
  maxSteps: 50,
  messages: [{ content: 'hello', id: 'u1', role: 'user' }] as any,
  modelRuntimeConfig: { model: 'gpt-4', provider: 'openai' },
  operationId: 'op-1',
  origin: { agentId: 'agent-1', threadId: 'thread-1', topicId: 'topic-1' },
  status: 'running',
  stepCount: 0,
  toolManifestMap: {},
  usage: createUsage(),
  ...overrides,
});

const createContext = (): AgentRuntimeContext => ({
  payload: {},
  phase: 'user_input',
  session: { messageCount: 1, sessionId: 'op-1', status: 'running', stepCount: 0 },
});

interface Harness {
  /** Queue of per-attempt outcomes. Defaults to success. */
  attempts: Array<'ok' | 'partial-window' | 'window'>;
  /** Queue of estimatedInputTokens returned by successive context.build calls. */
  budgets: number[];
  host: AgentRuntimeHost;
  messages: MessageTransport;
  stream: StreamSink;
}

const buildHarness = (opts: {
  attempts?: Array<'ok' | 'partial-window' | 'window'>;
  budgets: number[];
  /** When true the real compressContext summary stream throws (production catch path). */
  summaryFails?: boolean;
}): Harness => {
  const budgets = [...opts.budgets];
  const attempts = opts.attempts ? [...opts.attempts] : [];
  let assistantSeq = 0;

  const messages: MessageTransport = {
    createAssistantMessage: vi.fn().mockImplementation(async () => ({ id: `assistant-${++assistantSeq}` })),
    createToolMessage: vi.fn(),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    findById: vi.fn().mockImplementation(async (id: string) => ({ id })),
    findToolMessageIdByToolCallId: vi.fn(),
    getToolMessage: vi.fn(),
    query: vi.fn().mockResolvedValue([
      { content: 'hello', id: 'u1', role: 'user' },
      { content: 'prior answer', id: 'hist-1', role: 'assistant' },
    ]),
    update: vi.fn().mockResolvedValue(undefined),
    updatePluginState: vi.fn(),
    updateToolIntervention: vi.fn(),
    updateToolMessage: vi.fn(),
  };
  const stream: StreamSink = {
    publishChunk: vi.fn(),
    publishEvent: vi.fn().mockResolvedValue(undefined),
    publishError: vi.fn(),
  };

  const context: ContextBuilder = {
    build: vi.fn().mockImplementation(async () => {
      const est = budgets.length > 1 ? budgets.shift()! : budgets[0];
      return {
        estimatedInputTokens: est,
        messages: [{ content: 'hello', role: 'user' }],
        replayAssistantReasoning: false,
        resolvedTools: { enabledToolIds: [], manifestMap: {}, promptManifestMap: {}, sourceMap: {}, tools: [] },
      } satisfies ContextBuildOutput;
    }),
  };

  const runAttempt = vi.fn().mockImplementation(async () => {
    const kind = attempts.length > 0 ? attempts.shift()! : 'ok';
    if (kind === 'ok') return { ok: true, output: createAttemptOutput() };
    const error = Object.assign(new Error('maximum context length is 8192'), {
      errorType: 'ExceededContextWindow',
    });
    if (kind === 'partial-window') {
      return { error, ok: false, output: createAttemptOutput('partial text already streamed') };
    }
    return { error, ok: false };
  });

  const llm: LLMTransport = {
    createTrace: vi.fn().mockReturnValue({
      close: vi.fn(),
      onFirstChunk: vi.fn(),
      run: (task: () => Promise<unknown>) => task(),
    }),
    retryPolicy: {
      classifyError: vi.fn().mockReturnValue({ code: 'ExceededContextWindow', kind: 'stop', message: 'window' }),
      maxAttempts: vi.fn().mockReturnValue(1),
      onError: vi.fn(),
      onRetry: vi.fn(),
      resolveRetryBudget: vi.fn().mockReturnValue(0),
      waitForRetry: vi.fn().mockResolvedValue(undefined),
    },
    runAttempt,
    stream: opts.summaryFails
      ? vi.fn().mockRejectedValue(new Error('summary provider failed'))
      : vi.fn().mockResolvedValue({ content: 'summary of earlier turns' }),
  };

  const compression = {
    buildPrompt: vi.fn().mockResolvedValue({ messages: [{ content: 'summarize', role: 'user' }] }),
    createGroup: vi.fn().mockResolvedValue({
      messageGroupId: 'g-1',
      messagesToSummarize: [{ content: 'prior answer', id: 'hist-1', role: 'assistant' }],
    }),
    finalizeGroup: vi.fn().mockResolvedValue({
      messages: [{ content: 'summary of earlier turns', id: 'g-1', role: 'compressedGroup' }],
    }),
    rollbackGroup: vi.fn().mockResolvedValue(undefined),
    updateGroup: vi.fn(),
  };

  const host: AgentRuntimeHost = {
    operation: {
      agentId: 'agent-1',
      operationId: 'op-1',
      stepIndex: 0,
      topicId: 'topic-1',
      userId: 'u-1',
      workspaceId: 'ws-1',
    },
    transports: { compression: compression as any, context, llm, messages, stream },
  };
  return { attempts, budgets, host, messages, stream };
};

/** Simulated compress_context executor (shrinks on success, no-op on skip). */
const fakeCompress = (mode: 'success' | 'skip'): InstructionExecutor => async (_instruction, state) => {
  const newState = structuredClone(state);
  newState.metadata = {
    ...newState.metadata,
    contextOverflowAttempts: Number(newState.metadata?.contextOverflowAttempts ?? 0) + 1,
  };
  if (mode === 'success') {
    newState.messages = [
      { content: 'summary of earlier turns', id: 'summary-1', role: 'compressedGroup' },
      ...state.messages.filter((m: any) => m.role === 'user').slice(-1),
    ] as any;
  }
  return {
    events: [],
    newState,
    nextContext: {
      payload: {
        compressedMessages: newState.messages,
        groupId: 'g-1',
        parentMessageId: 'assistant-parent',
        skipped: mode === 'skip',
      },
      phase: 'compression_result',
      session: { messageCount: newState.messages.length, sessionId: 'op-1', status: 'running', stepCount: newState.stepCount },
    },
  };
};

const agent = () =>
  new GeneralChatAgent({
    agentConfig: { maxSteps: 50 },
    compressionConfig: { enabled: true, maxWindowToken: 200_000, thresholdRatio: 0.5 },
    modelRuntimeConfig: { model: 'gpt-4', provider: 'openai' },
    operationId: 'op-1',
  });

const buildRuntime = (h: Harness, compress: 'success' | 'skip' | 'real') =>
  new AgentRuntime(agent(), {
    executors: {
      call_llm: callLlm(h.host),
      compress_context: compress === 'real' ? compressContext(h.host) : fakeCompress(compress),
    },
    operationId: 'op-1',
  });

const runLoop = async (runtime: AgentRuntime, state: AgentState) => {
  let current = state;
  let ctx: AgentRuntimeContext | undefined = createContext();
  const phases: string[] = [];
  for (let i = 0; i < 12 && ctx; i++) {
    phases.push(ctx.phase);
    const res = await runtime.step(current, ctx);
    current = res.newState;
    ctx = res.nextContext;
    if (current.status === 'done' || current.status === 'error') break;
  }
  return { finalState: current, phases };
};

describe('compression recovery closed loop (real agent + real runtime)', () => {
  it('pre-send overflow with a seed: compress, retry succeeds, reply identity is the seed', async () => {
    const h = buildHarness({ budgets: [150_000, 50_000] });
    const runtime = buildRuntime(h, 'success');
    const state = createState({ pendingAssistantMessageId: 'seed-1' });

    const { finalState, phases } = await runLoop(runtime, state);

    expect(phases).toContain('context_overflow');
    expect(phases).toContain('compression_result');
    expect(h.messages.createAssistantMessage).not.toHaveBeenCalled();
    expect(finalState.status).toBe('done');
    expect(finalState.llmCalls).toBe(1);
    expect(finalState.pendingAssistantMessageId).toBeUndefined();
  });

  it('no seed: one assistant row created for the retry, unused calls not counted', async () => {
    const h = buildHarness({ budgets: [150_000, 50_000] });
    const runtime = buildRuntime(h, 'success');
    const { finalState } = await runLoop(runtime, createState());
    expect(h.messages.createAssistantMessage).toHaveBeenCalledTimes(1);
    expect(finalState.status).toBe('done');
    expect(finalState.llmCalls).toBe(1);
  });

  it('two independent overflow rounds both recover: the reset really clears the consumed budget', async () => {
    // Round 1: overflow -> compress (consume attempt) -> retry success (clear).
    const h1 = buildHarness({ budgets: [150_000, 50_000] });
    const first = await runLoop(buildRuntime(h1, 'success'), createState());
    expect(first.phases).toContain('context_overflow');
    expect(first.finalState.status).toBe('done');
    expect(first.finalState.metadata?.contextOverflowAttempts).toBeUndefined();

    // Round 2 continues the SAME state: another overflow must still recover.
    // If the finalizer did not clear the consumed attempt, priorAttempts would be
    // 1 here, this overflow would exceed the bound, and the run would end error.
    // After the first compression the conversation carries a summary, so the
    // recompression watermark is 0.8 (160k), not the initial 0.5 (100k).
    const h2 = buildHarness({ budgets: [170_000, 50_000] });
    const second = await runLoop(buildRuntime(h2, 'success'), {
      ...first.finalState,
      status: 'running',
    });
    expect(second.phases).toContain('context_overflow');
    expect(second.finalState.status).toBe('done');
    // One real send per round, cumulative on the carried state.
    expect(second.finalState.llmCalls).toBe(2);
  });

  it('compression skipped and still over: bounded exit into error', async () => {
    const h = buildHarness({ budgets: [150_000] });
    const runtime = buildRuntime(h, 'skip');
    const { finalState } = await runLoop(runtime, createState());
    expect(finalState.status).toBe('error');
    expect(finalState.llmCalls ?? 0).toBe(0);
  });

  it('real compressContext summary failure: rollback -> skipped -> re-plan -> bounded error', async () => {
    // Always over budget; the REAL compressContext summary stream throws, so it
    // catches, rolls back and returns skipped; re-plan still over -> bound hit.
    const h = buildHarness({ budgets: [150_000], summaryFails: true });
    const runtime = buildRuntime(h, 'real');
    const state = createState({
      messages: [
        { content: 'hello', id: 'u1', role: 'user' },
        { content: 'prior answer', id: 'hist-1', role: 'assistant' },
      ] as any,
    });

    const { finalState, phases } = await runLoop(runtime, state);

    expect(phases).toContain('context_overflow');
    // Production catch path ran: rollback was invoked.
    expect((h.host.transports.compression as any).rollbackGroup).toHaveBeenCalled();
    expect(finalState.status).toBe('error');
  });

  it('provider window rejection with partial output: not auto-recovered, output saved to the owned reply', async () => {
    const h = buildHarness({ budgets: [50_000], attempts: ['partial-window'] });
    const runtime = buildRuntime(h, 'success');
    // A historical assistant that must NOT be touched.
    const state = createState({
      messages: [
        { content: 'hello', id: 'u1', role: 'user' },
        { content: 'old reply', id: 'hist-1', role: 'assistant' },
      ] as any,
    });

    const { finalState, phases } = await runLoop(runtime, state);

    expect(phases).not.toContain('context_overflow');
    expect(finalState.status).toBe('error');
    // The partial output is saved to the assistant this operation created...
    expect(h.messages.update).toHaveBeenCalledWith(
      'assistant-1',
      expect.objectContaining({ content: 'partial text already streamed' }),
    );
    // ...and the historical assistant is never updated.
    expect(h.messages.update).not.toHaveBeenCalledWith('hist-1', expect.anything());
  });
});
