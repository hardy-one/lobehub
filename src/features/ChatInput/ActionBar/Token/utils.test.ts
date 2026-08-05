import { describe, expect, it } from 'vitest';

import {
  estimateContextDelta,
  estimateContextTotal,
  estimateTokenBreakdown,
  scaleBreakdown,
} from './utils';

/**
 * Contract tests for the pure estimator. The estimator uses the SAME real
 * tool-generation functions as the send path (createAgentToolsEngine +
 * generateToolsDetailed + composeEnabledTools + prompt components), so the
 * tools bucket tracks the real payload by construction; these tests pin the
 * bucket arithmetic and the efficient-mode behavior.
 */
describe('estimateTokenBreakdown', () => {
  const base = {
    agentId: 'agent-1',
    model: 'gpt-4',
    provider: 'openai',
    pluginIds: [] as string[],
    promptMode: 'full' as const,
    enableAgentMode: false,
    skillActivateMode: 'auto' as const,
    messages: [] as Array<{ content?: unknown }>,
    draft: '',
    systemRole: '',
    personaText: '',
    historySummary: '',
  };

  it('returns zero buckets for an empty conversation', () => {
    const result = estimateTokenBreakdown(base);
    expect(result.chats).toBe(0);
    expect(result.historySummary).toBe(0);
    expect(result.tools).toBeGreaterThanOrEqual(0);
    expect(result.systemRole).toBeGreaterThanOrEqual(0);
  });

  it('grows the systemRole bucket with system role and persona text', () => {
    const empty = estimateTokenBreakdown(base);
    const withRole = estimateTokenBreakdown({
      ...base,
      systemRole: 'You are a helpful assistant that always answers in Chinese.',
      personaText: 'The user is called Hardy and works at LobeHub.',
    });
    expect(withRole.systemRole).toBeGreaterThan(empty.systemRole);
  });

  it('grows the chats bucket with window messages and the templated draft', () => {
    const empty = estimateTokenBreakdown(base);
    const withChats = estimateTokenBreakdown({
      ...base,
      messages: [{ content: 'Hello there, this is a user message.' }],
      draft: 'And this is the composer draft being typed.',
    });
    expect(withChats.chats).toBeGreaterThan(empty.chats);
  });

  it('grows the historySummary bucket with the topic summary', () => {
    const empty = estimateTokenBreakdown(base);
    const withSummary = estimateTokenBreakdown({
      ...base,
      historySummary: 'Earlier the user asked about token estimation and we discussed caching.',
    });
    expect(withSummary.historySummary).toBeGreaterThan(empty.historySummary);
  });

  // NOTE: the tools bucket is generated with the REAL send functions
  // (createAgentToolsEngine + generateToolsDetailed + prompt components), so
  // its exact size depends on the tool store's registered manifests — pinned
  // here only via the efficient-mode behavior below, which exercises the
  // deferral + prompt-swap path against the real store.

  it('shrinks the tools bucket in efficient mode (agent + lean defers long-tail plugins)', () => {
    const full = estimateTokenBreakdown({
      ...base,
      pluginIds: ['lobe-agent'],
      promptMode: 'full',
      enableAgentMode: false,
    });
    const efficient = estimateTokenBreakdown({
      ...base,
      pluginIds: ['lobe-agent'],
      promptMode: 'lean',
      enableAgentMode: true,
    });
    expect(efficient.tools).toBeLessThan(full.tools);
  });

  it('is deterministic for identical inputs', () => {
    expect(estimateTokenBreakdown(base)).toEqual(estimateTokenBreakdown(base));
  });
});

describe('estimateContextTotal (real baseline + incremental delta)', () => {
  const mkWindowMsg = (id: string, content: string) => ({ content, id });

  it('returns undefined when no stored baseline exists', () => {
    expect(
      estimateContextTotal({
        draft: '',
        messages: [mkWindowMsg('m1', 'hello')],
        storedContext: undefined,
      }),
    ).toBeUndefined();
  });

  it('uses the stored baseline as-is when the anchor is the last message', () => {
    const result = estimateContextTotal({
      draft: '',
      messages: [mkWindowMsg('anchor', 'previous turn')],
      storedContext: { lastMsgId: 'anchor', tokens: 50_000 },
    });
    expect(result).toBe(50_000);
  });

  it('adds an estimate for messages after the anchor', () => {
    const result = estimateContextTotal({
      draft: '',
      messages: [mkWindowMsg('anchor', 'x'), mkWindowMsg('new-1', 'y'.repeat(2000))],
      storedContext: { lastMsgId: 'anchor', tokens: 50_000 },
    });
    expect(result!).toBeGreaterThan(50_000);
    // delta = the post-anchor message only (50k baseline is untouched)
    expect(result! - 50_000).toBeGreaterThan(0);
    expect(result! - 50_000).toBeLessThan(2_000);
  });

  it('includes the in-progress draft on top of baseline + delta', () => {
    const base = estimateContextTotal({
      draft: '',
      messages: [mkWindowMsg('anchor', 'x')],
      storedContext: { lastMsgId: 'anchor', tokens: 50_000 },
    })!;
    const withDraft = estimateContextTotal({
      draft: 'typing some draft text here',
      messages: [mkWindowMsg('anchor', 'x')],
      storedContext: { lastMsgId: 'anchor', tokens: 50_000 },
    })!;
    expect(withDraft).toBeGreaterThan(base);
  });

  it('falls back (undefined) when the anchor message is gone', () => {
    const result = estimateContextTotal({
      draft: '',
      messages: [mkWindowMsg('other', 'compressed or deleted')],
      storedContext: { lastMsgId: 'anchor', tokens: 50_000 },
    });
    expect(result).toBeUndefined();
  });
});

describe('estimateContextDelta (post-anchor delta for the real-breakdown chats bucket)', () => {
  const mkWindowMsg = (id: string, content: string) => ({ content, id });

  it('returns 0 without a stored baseline', () => {
    expect(estimateContextDelta({ draft: 'x', messages: [], storedContext: undefined })).toBe(0);
  });

  it('counts messages after the anchor plus the draft', () => {
    const delta = estimateContextDelta({
      draft: 'draft text',
      messages: [mkWindowMsg('anchor', 'a'), mkWindowMsg('m1', 'hello world')],
      storedContext: { lastMsgId: 'anchor', tokens: 50_000 },
    });
    expect(delta).toBeGreaterThan(0);
    expect(delta).toBeLessThan(10_000);
  });

  it('returns 0 when the anchor is gone (compressed/deleted)', () => {
    expect(
      estimateContextDelta({
        draft: 'x',
        messages: [mkWindowMsg('other', 'y')],
        storedContext: { lastMsgId: 'anchor', tokens: 50_000 },
      }),
    ).toBe(0);
  });
});

describe('scaleBreakdown (distribute a real total across estimated buckets)', () => {
  it('scales every bucket proportionally so the sum equals the target', () => {
    const scaled = scaleBreakdown(
      { chats: 29, historySummary: 0, systemRole: 822, tools: 2800 },
      7_904,
    );
    const sum = scaled.chats + scaled.historySummary + scaled.systemRole + scaled.tools;
    // Rounding may drift the sum by ±1 per bucket.
    expect(sum).toBeGreaterThanOrEqual(7_902);
    expect(sum).toBeLessThanOrEqual(7_906);
    expect(scaled.systemRole).toBeGreaterThan(822);
  });

  it('returns the breakdown unchanged when the estimate is zero', () => {
    const zero = { chats: 0, historySummary: 0, systemRole: 0, tools: 0 };
    expect(scaleBreakdown(zero, 100)).toEqual(zero);
  });

  it('returns the breakdown unchanged when target equals the estimate', () => {
    const b = { chats: 1, historySummary: 2, systemRole: 3, tools: 4 };
    expect(scaleBreakdown(b, 10)).toEqual(b);
  });
});
