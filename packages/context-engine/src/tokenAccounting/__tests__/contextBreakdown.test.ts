import { describe, expect, it } from 'vitest';

import { estimateUiBreakdown } from '../contextBreakdown';

const SYSTEM_PROMPT = [
  '## 规则',
  '',
  '1. 称呼用户为 **Hardy**',
  '',
  '<available_skills>',
  '- skill-a: does a',
  '- skill-b: does b',
  '</available_skills>',
  '',
  '<lobe_tool_policy>',
  '- memory writes default to medium effort',
  '</lobe_tool_policy>',
].join('\n');

describe('estimateUiBreakdown', () => {
  it('splits a system prompt into systemRole preamble + tools block', () => {
    const b = estimateUiBreakdown({ messages: [{ content: SYSTEM_PROMPT, role: 'developer' }] });
    expect(b.systemRole).toBeGreaterThan(0);
    expect(b.tools).toBeGreaterThan(0);
    // Preamble (rules) is much smaller than the skills+policy block.
    expect(b.systemRole!).toBeLessThan(b.tools!);
    expect(b.historySummary).toBeUndefined();
    expect(b.chats).toBeUndefined();
  });

  it('counts <user_memory> persona into the systemRole bucket', () => {
    const persona =
      '<user_memory> <instruction>memories about the user</instruction> <user_memory>...';
    const b = estimateUiBreakdown({
      messages: [
        { content: '## 规则\n1. rule', role: 'developer' },
        { content: persona, role: 'user' },
        { content: 'Hi', role: 'user' },
      ],
    });
    expect(b.systemRole).toBeGreaterThan(0);
    expect(b.chats).toBe(1); // only "Hi" counts as a chat message
  });

  it('counts the tools schema in the tools bucket', () => {
    const b = estimateUiBreakdown({
      messages: [{ content: 'preamble', role: 'developer' }],
      tools: [{ function: { name: 'a', description: 'x', parameters: { type: 'object' } } }],
    });
    expect(b.tools).toBeGreaterThan(0);
  });

  it('keeps summary/system summary messages in the historySummary bucket', () => {
    const b = estimateUiBreakdown({
      messages: [
        { content: 'earlier conversation compressed', role: 'summary' },
        { content: 'plain chat', role: 'user' },
      ],
    });
    expect(b.historySummary).toBeGreaterThan(0);
    expect(b.chats).toBeGreaterThan(0);
  });

  it('returns empty breakdown for empty input', () => {
    expect(estimateUiBreakdown({})).toEqual({});
  });
});
