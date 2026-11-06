import { describe, expect, it } from 'vitest';

import { type AgentRuntimeContext, type AgentState } from '../../types';
import { GeneralChatAgent } from '../GeneralChatAgent';

/**
 * The compression trigger used to count the runtime working set, whose tool
 * results are still the untrimmed originals, and it cannot see the prompt
 * preamble the context engine assembles afterwards. Both push the estimate away
 * from what the provider actually charges, so the check now counts from the
 * provider-measured usage of the last completed call when there is one.
 */
describe('GeneralChatAgent compression baseline', () => {
  const modelRuntimeConfig = { model: 'gpt-4o-mini', provider: 'openai' };

  const createState = (overrides?: Partial<AgentState>): AgentState => ({
    cost: {
      calculatedAt: new Date().toISOString(),
      currency: 'USD',
      llm: { byModel: [], currency: 'USD', total: 0 },
      tools: { byTool: [], currency: 'USD', total: 0 },
      total: 0,
    },
    createdAt: new Date().toISOString(),
    lastModified: new Date().toISOString(),
    messages: [],
    operationId: 'test-session',
    status: 'running',
    stepCount: 0,
    toolManifestMap: {},
    usage: {
      humanInteraction: {
        approvalRequests: 0,
        promptRequests: 0,
        selectRequests: 0,
        totalWaitingTimeMs: 0,
      },
      llm: { apiCalls: 0, processingTimeMs: 0, tokens: { input: 0, output: 0, total: 0 } },
      tools: { byTool: [], totalCalls: 0, totalTimeMs: 0 },
    },
    ...overrides,
  });

  const createContext = (): AgentRuntimeContext => ({
    payload: {},
    phase: 'user_input',
    session: { messageCount: 0, sessionId: 'test-session', status: 'running', stepCount: 0 },
  });

  const createAgent = () =>
    new GeneralChatAgent({
      agentConfig: { maxSteps: 100 },
      compressionConfig: { enabled: true, maxWindowToken: 200_000, thresholdRatio: 0.5 },
      modelRuntimeConfig,
      operationId: 'test-session',
    });

  it('compresses from the measured baseline of the previous call', async () => {
    // 150k measured against a 100k threshold. The visible text is a few tokens,
    // so only the recorded baseline can trip the check.
    const messages = [
      { content: 'Hello', id: 'user-1', role: 'user' },
      { content: 'Hi', id: 'assistant-1', model: 'gpt-4o-mini', role: 'assistant' },
    ] as any;
    const state = createState({
      messages,
      metadata: {
        compressionBaseline: { model: 'gpt-4o-mini', msgId: 'assistant-1', tokens: 150_000 },
      },
    });

    const result = await createAgent().runner(createContext(), state);

    expect(result).toEqual({
      payload: {
        currentTokenCount: expect.any(Number),
        existingSummary: undefined,
        messages,
      },
      type: 'compress_context',
    });
  });

  it('ignores a baseline measured by another model', async () => {
    const state = createState({
      messages: [
        { content: 'Hello', id: 'user-1', role: 'user' },
        { content: 'Hi', id: 'assistant-1', role: 'assistant' },
      ] as any,
      metadata: {
        compressionBaseline: { model: 'some-other-model', msgId: 'assistant-1', tokens: 150_000 },
      },
    });

    const result = await createAgent().runner(createContext(), state);

    expect((result as any).type).toBe('call_llm');
  });

  it('ignores a baseline whose anchor message is no longer in the conversation', async () => {
    const state = createState({
      messages: [{ content: 'Compressed summary', id: 'summary-1', role: 'user' }] as any,
      metadata: {
        compressionBaseline: { model: 'gpt-4o-mini', msgId: 'assistant-1', tokens: 150_000 },
      },
    });

    const result = await createAgent().runner(createContext(), state);

    expect((result as any).type).toBe('call_llm');
  });

  it('uses the estimate path on the first turn without a baseline', async () => {
    const state = createState({
      messages: [{ content: 'First question', id: 'user-1', role: 'user' }] as any,
    });

    const result = await createAgent().runner(createContext(), state);

    expect((result as any).type).toBe('call_llm');
  });
});
