import { describe, expect, it, vi } from 'vitest';

import { GeneralChatAgent } from '../agents/GeneralChatAgent';
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
  AgentRuntimeContext,
  AgentState,
  InstructionExecutor,
} from '../types';

/**
 * Full-loop scheduling evidence for the compression-recovery contract: the REAL
 * `GeneralChatAgent` planning + REAL `callLlm`, driven through the REAL
 * `AgentRuntime.step` loop, with a simulated compress_context executor and fake
 * host/provider/message store. Covers the bounded recovery closed loop (compress
 * then retry success, budget reset, bounded failure, seed ownership), which a
 * single-step test cannot.
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
  attempts: Array<'ok' | 'window' | 'partial-window'>;
  /** Queue of estimatedInputTokens returned by successive context.build calls. */
  budgets: number[];
  host: AgentRuntimeHost;
  messages: MessageTransport;
  stream: StreamSink;
}

const buildHarness = (opts: {
  budgets: number[];
  attempts?: Array<'ok' | 'window' | 'partial-window'>;
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
    query: vi.fn().mockResolvedValue([]),
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
    const error = Object.assign(
      new Error(kind === 'partial-window' ? 'maximum context length is 8192' : 'maximum context length is 8192'),
      { errorType: 'ExceededContextWindow' },
    );
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
    stream: vi.fn(),
  };

  const host: AgentRuntimeHost = {
    operation: { operationId: 'op-1', stepIndex: 0 },
    transports: { context, llm, messages, stream },
  };
  return { attempts, budgets, host, messages, stream };
};

/** Simulated compress_context executor. mode controls whether it shrinks. */
const fakeCompress = (
  mode: 'success' | 'skip' | 'fail',
): InstructionExecutor => async (_instruction, state) => {
  const newState = structuredClone(state);
  newState.metadata = {
    ...newState.metadata,
    contextOverflowAttempts: Number(newState.metadata?.contextOverflowAttempts ?? 0) + 1,
  };
  if (mode === 'fail') throw new Error('compression failed');
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

const buildRuntime = (h: Harness, compressMode: 'success' | 'skip' | 'fail') =>
  new AgentRuntime(agent(), {
    executors: { call_llm: callLlm(h.host), compress_context: fakeCompress(compressMode) },
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

describe('compression recovery closed loop (real agent + real callLlm + real runtime)', () => {
  it('pre-send overflow with a seed: compress, retry succeeds, reply identity is the seed', async () => {
    const h = buildHarness({ budgets: [150_000, 50_000] });
    const runtime = buildRuntime(h, 'success');
    const state = createState({ pendingAssistantMessageId: 'seed-1' });

    const { finalState, phases } = await runLoop(runtime, state);

    expect(phases).toContain('context_overflow');
    expect(phases).toContain('compression_result');
    // Only the final successful send created no new row: it reused the seed.
    expect(h.messages.createAssistantMessage).not.toHaveBeenCalled();
    expect(finalState.status).toBe('done');
    // Exactly one real send counted.
    expect(finalState.llmCalls).toBe(1);
    // Seed consumed on the successful send.
    expect(finalState.pendingAssistantMessageId).toBeUndefined();
  });

  it('no seed: one assistant row created for the retry, unused calls not counted', async () => {
    const h = buildHarness({ budgets: [150_000, 50_000] });
    const runtime = buildRuntime(h, 'success');
    const state = createState();

    const { finalState } = await runLoop(runtime, state);

    expect(h.messages.createAssistantMessage).toHaveBeenCalledTimes(1);
    expect(finalState.status).toBe('done');
    expect(finalState.llmCalls).toBe(1);
  });

  it('success then an independent later overflow: recovery budget was reset', async () => {
    // 1st send ok, then another send over-budget, compress, retry ok.
    const h = buildHarness({ budgets: [50_000, 150_000, 50_000], attempts: ['ok', 'ok'] });
    const runtime = buildRuntime(h, 'success');
    // Two turns: first user turn, then a second independent user_input.
    const first = await runLoop(runtime, createState());
    expect(first.finalState.status).toBe('done');
    expect(first.finalState.metadata?.contextOverflowAttempts).toBeUndefined();

    // A later independent overflow must still be able to recover (budget reset).
    const second = await runLoop(runtime, createState({ ...first.finalState, status: 'running' }));
    expect(second.finalState.status).toBe('done');
    expect(second.phases).toContain('context_overflow');
  });

  it('compression skipped and still over: bounded exit into error, bounded attempts', async () => {
    // Always over budget; skip never shrinks -> second overflow exhausts budget.
    const h = buildHarness({ budgets: [150_000], attempts: ['ok'] });
    const runtime = buildRuntime(h, 'skip');
    const state = createState();

    const { finalState } = await runLoop(runtime, state);

    expect(finalState.status).toBe('error');
    // Never sent an LLM request (both context builds over budget).
    expect(finalState.llmCalls ?? 0).toBe(0);
  });

  it('compression failure: bounded exit into error', async () => {
    const h = buildHarness({ budgets: [150_000] });
    const runtime = buildRuntime(h, 'fail');
    const state = createState();

    const { finalState } = await runLoop(runtime, state);

    expect(finalState.status).toBe('error');
  });

  it('provider window rejection with partial output is NOT auto-recovered and fails', async () => {
    const h = buildHarness({ budgets: [50_000], attempts: ['partial-window'] });
    const runtime = buildRuntime(h, 'success');
    const state = createState();

    const { finalState, phases } = await runLoop(runtime, state);

    expect(phases).not.toContain('context_overflow');
    expect(finalState.status).toBe('error');
  });
});
