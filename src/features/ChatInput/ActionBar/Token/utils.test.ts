import { describe, expect, it } from 'vitest';

import { estimateTokenBreakdown } from './utils';

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
