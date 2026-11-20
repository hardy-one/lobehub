import { describe, expect, it } from 'vitest';

import type { Message, PipelineContext } from '../../types';
import { TimeReminderInjector } from '../TimeReminderInjector';

const BASE = Date.parse('2026-11-19T20:00:00Z');
const MIN = 60 * 1000;

const makeContext = (messages: Message[]): PipelineContext => ({
  initialState: {
    messages: [],
    model: 'test-model',
    provider: 'test-provider',
  },
  isAborted: false,
  messages,
  metadata: {
    maxTokens: 4000,
    model: 'test-model',
  },
});

// offsets (min): dense at first, then sparse — exercises the >= 10min cadence
const OFFSETS = [0, 2, 4, 9, 35, 37, 70, 72, 74, 130, 132, 200];
const messageAt = (i: number, createdAt: number | string): Message => ({
  content: `user ${i}`,
  createdAt,
  role: 'user',
});

// Extract the text of every time_reminder block from the processed messages.
const reminderTexts = (messages: Message[]): string[] => {
  const out: string[] = [];
  for (const m of messages) {
    if (typeof m.content !== 'string') continue;
    for (const match of m.content.matchAll(/It is ([^<]+)\./g)) out.push(match[1]);
  }
  return out;
};

describe('TimeReminderInjector', () => {
  it('injects a bare time_reminder block prepended to the user text (no SYSTEM CONTEXT wrapper)', async () => {
    const result = await new TimeReminderInjector({
      enabled: true,
      timezone: 'UTC',
    }).process(makeContext([messageAt(0, BASE)]));

    const content = String(result.messages[0].content);
    expect(content).toBe(
      '<time_reminder>\nIt is 2026-11-19 20:00:00 (UTC).\n</time_reminder>\n\nuser 0',
    );
    expect(content.startsWith('<time_reminder>')).toBe(true);
    expect(content.endsWith('user 0')).toBe(true);
    expect(content).not.toContain('SYSTEM CONTEXT');
    expect(content).not.toContain('context.instruction');
  });

  it('prepends into the first text part of multimodal content', async () => {
    const message: Message = {
      content: [
        { text: 'describe this', type: 'text' },
        { image_url: { url: 'http://x/y.png' }, type: 'image_url' },
      ],
      createdAt: BASE,
      role: 'user',
    };
    const result = await new TimeReminderInjector({
      enabled: true,
      timezone: 'UTC',
    }).process(makeContext([message]));

    const parts = result.messages[0].content as any[];
    expect(parts[0].type).toBe('text');
    expect(parts[0].text).toBe(
      '<time_reminder>\nIt is 2026-11-19 20:00:00 (UTC).\n</time_reminder>\n\ndescribe this',
    );
    expect(parts[1].type).toBe('image_url');
  });

  it('injects on a deterministic 10-min cadence by createdAt', async () => {
    const messages = OFFSETS.map((off, i) => messageAt(i, BASE + off * MIN));
    const result = await new TimeReminderInjector({
      enabled: true,
      timezone: 'UTC',
    }).process(makeContext(messages));

    // 0 -> inject; 2/4/9 skipped; 35 (>=10 from 0) inject; 37 skipped;
    // 70 inject; 72/74 skipped; 130 inject; 132 skipped; 200 inject.
    expect(reminderTexts(result.messages)).toEqual([
      '2026-11-19 20:00:00 (UTC)',
      '2026-11-19 20:35:00 (UTC)',
      '2026-11-19 21:10:00 (UTC)',
      '2026-11-19 22:10:00 (UTC)',
      '2026-11-19 23:20:00 (UTC)',
    ]);
  });

  it('keeps the injected prefix byte-identical as messages grow', async () => {
    // This is the core cache regression: adding later messages must not change
    // which earlier messages were injected (a wall-clock-based throttle would fail).
    const all = OFFSETS.map((off, i) => messageAt(i, BASE + off * MIN));
    const first6 = all.slice(0, 6);

    const provider = new TimeReminderInjector({ enabled: true, timezone: 'UTC' });
    const from6 = reminderTexts((await provider.process(makeContext(first6))).messages);
    const from12 = reminderTexts((await provider.process(makeContext(all))).messages);

    // The reminders present in the 6-message build must be an exact prefix of
    // the 12-message build — same values, same order, no new early insertions.
    expect(from12.slice(0, from6.length)).toEqual(from6);
    expect(from6).toEqual(['2026-11-19 20:00:00 (UTC)', '2026-11-19 20:35:00 (UTC)']);
  });

  it('skips synthetic injection carriers so the cadence anchors on real turns', async () => {
    // Reproduces the trace bug: BaseFirstUserContentProvider-style carriers are
    // role=user with createdAt=now and sit ahead of the real history. Counting
    // them anchored the first reminder on "now" and collapsed all real turns
    // into a single reminder on the carrier.
    const carrier: Message = {
      content: '<user_memory>...</user_memory>',
      createdAt: BASE + 200 * MIN, // injected at "now" — newest of all
      meta: { systemInjection: true },
      role: 'user',
    };
    const realMessages = [
      messageAt(0, BASE),
      { content: 'assistant', createdAt: BASE + MIN, role: 'assistant' },
      messageAt(1, BASE + 35 * MIN),
    ];
    const result = await new TimeReminderInjector({
      enabled: true,
      timezone: 'UTC',
    }).process(makeContext([carrier, ...realMessages]));

    // The carrier must stay clean...
    expect(String(result.messages[0].content)).not.toContain('<time_reminder>');
    // ...and each real turn gets its own snapshot on the normal cadence.
    expect(reminderTexts(result.messages)).toEqual([
      '2026-11-19 20:00:00 (UTC)',
      '2026-11-19 20:35:00 (UTC)',
    ]);
  });

  it('skips virtual-tail carriers (virtualLastUser)', async () => {
    const carrier: Message = {
      content: 'virtual tail',
      createdAt: BASE + 200 * MIN,
      meta: { virtualLastUser: true },
      role: 'user',
    };
    const result = await new TimeReminderInjector({
      enabled: true,
      timezone: 'UTC',
    }).process(makeContext([messageAt(0, BASE), carrier]));

    expect(String(result.messages[1].content)).not.toContain('<time_reminder>');
    expect(reminderTexts(result.messages)).toEqual(['2026-11-19 20:00:00 (UTC)']);
  });

  it('skips agent-mention-delegation carriers (no systemInjection tag)', async () => {
    // AgentManagementContextInjector splices this as a standalone role:'user'
    // message with createdAt=now, deliberately NOT tagged systemInjection. It
    // must stay clean and must not become a false cadence anchor.
    const mention: Message = {
      content: '<mentioned_agents>...delegate...</mentioned_agents>',
      createdAt: BASE + 200 * MIN,
      meta: { injectType: 'agent-mention-delegation' },
      role: 'user',
    };
    const result = await new TimeReminderInjector({
      enabled: true,
      timezone: 'UTC',
    }).process(makeContext([messageAt(0, BASE), mention, messageAt(1, BASE + 35 * MIN)]));

    expect(String(result.messages[1].content)).not.toContain('<time_reminder>');
    // The real turns still anchor on themselves, not on the mention's Date.now().
    expect(reminderTexts(result.messages)).toEqual([
      '2026-11-19 20:00:00 (UTC)',
      '2026-11-19 20:35:00 (UTC)',
    ]);
  });

  it('normalizes epoch number and ISO string createdAt, and ignores invalid timezone', async () => {
    const messages: Message[] = [
      { content: 'number', createdAt: BASE, role: 'user' },
      { content: 'iso', createdAt: new Date(BASE + 40 * MIN).toISOString(), role: 'user' },
    ];

    const result = await new TimeReminderInjector({
      enabled: true,
      timezone: 'Asia/Shanghai',
    }).process(makeContext(messages));
    expect(reminderTexts(result.messages)).toEqual([
      // 20:00Z -> 04:00 next day in Shanghai; 40min apart -> both injected
      '2026-11-20 04:00:00 (Asia/Shanghai)',
      '2026-11-20 04:40:00 (Asia/Shanghai)',
    ]);

    // Invalid timezone: no injection, no throw (pipeline must survive).
    const bad = await new TimeReminderInjector({
      enabled: true,
      timezone: 'Not/AZone',
    }).process(makeContext(messages));
    expect(reminderTexts(bad.messages)).toEqual([]);
  });
});
