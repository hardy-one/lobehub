import { formatMentionedAgentsContext } from '@lobechat/context-engine';
import { INJECTION_SOURCE_KEYS } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import type { UIChatMessage } from '@/types/index';

import { MessagesEngine } from '../MessagesEngine';
import type { MessagesEngineParams } from '../types';

/**
 * Batch 0-C2: turn-scoped persistence switch (context-engine surface).
 *
 * The legacy injector for a persisted source is silenced ONLY when the current
 * turn owns a row for that source. The current turn is the newest non-injection
 * `user` row. These tests pin the frozen contract:
 * - real parentId anchor: exact match to the current turn;
 * - legacy parentId=null rows: accepted in [turn.createdAt, +64), debug-logged;
 * - historical rows (other parentId / outside the window) replay but never
 *   count as current `hasPersisted`, so a live need re-fires the legacy injector;
 * - `hasPersisted` is a boolean: multiple same-source rows on one turn all
 *   replay (no source dedup), and the legacy injector stays silent.
 */
const B1 = INJECTION_SOURCE_KEYS.MENTION_DELEGATION;
const at = 1_700_000_000_000;
const mentionedAgents = [{ id: 'agt_delegate', name: 'Delegate' }];
const block = formatMentionedAgentsContext(mentionedAgents);

const msg = (
  partial: Partial<UIChatMessage> & { id: string; role: UIChatMessage['role'] },
): UIChatMessage => ({ createdAt: at, updatedAt: at, ...partial }) as UIChatMessage;

const user = (id: string, createdAt: number): UIChatMessage =>
  msg({ content: `user ${id}`, createdAt, id, role: 'user' });

const injection = (id: string, createdAt: number, parentId: string | undefined): UIChatMessage =>
  msg({
    content: block,
    createdAt,
    id,
    isInjection: true,
    parentId,
    role: 'user',
    sourceKey: B1,
  });

const params = (messages: UIChatMessage[]): MessagesEngineParams => ({
  agentManagementContext: { mentionedAgents },
  enableSystemDate: false,
  messages,
  model: 'gpt-4',
  provider: 'openai',
  systemRole: 'You are a helpful assistant.',
});

const count = async (messages: UIChatMessage[]): Promise<number> => {
  const result = await new MessagesEngine(params(messages)).process();
  return (JSON.stringify(result.messages).match(/<mentioned_agents>/g) ?? []).length;
};

describe('MessagesEngine turn-scoped persisted-injection switch', () => {
  it('picks the newest non-injection user row as the current turn', async () => {
    const u1 = user('u1', at);
    const u2 = user('u2', at + 1000);
    // Row anchored to the OLD turn u1; the live need belongs to u2.
    const oldRow = injection('old', at + 1, u1.id);

    // u2 is current -> oldRow is history -> legacy re-fires: replay + legacy = 2.
    expect(await count([u1, oldRow, u2])).toBe(2);
  });

  it('silences the legacy injector when a current-turn parentId row exists', async () => {
    const u1 = user('u1', at);
    const u2 = user('u2', at + 1000);
    const currentRow = injection('cur', at + 1001, u2.id);

    // Current turn owns the row -> replay only -> 1.
    expect(await count([u1, u2, currentRow])).toBe(1);
  });

  it('accepts a parentId=null legacy row inside [turn.createdAt, +64)', async () => {
    const u1 = user('u1', at + 1000);
    // Boundary: createdAt === turn.createdAt (left-closed).
    expect(await count([u1, injection('legacy-0', at + 1000, undefined)])).toBe(1);
    // Inside the window: +63.
    expect(await count([u1, injection('legacy-63', at + 1063, undefined)])).toBe(1);
  });

  it('rejects a parentId=null legacy row outside the window (right-open at +64)', async () => {
    const u1 = user('u1', at + 1000);
    // +64 is excluded (right-open) -> history -> legacy re-fires = 2.
    expect(await count([u1, injection('legacy-64', at + 1064, undefined)])).toBe(2);
    // Before the turn is also outside -> 2.
    expect(await count([u1, injection('legacy-before', at + 999, undefined)])).toBe(2);
  });

  it('does not let a historical row with another parentId join current hasPersisted', async () => {
    const u1 = user('u1', at);
    const u2 = user('u2', at + 1000);
    const assistant = msg({ content: 'a1', id: 'a1', role: 'assistant' });
    // Row parented on an assistant is neither the current turn nor a null-legacy row.
    const stray = injection('stray', at + 1001, assistant.id);
    expect(await count([u1, assistant, u2, stray])).toBe(2);
  });

  it('keeps multiple same-source rows on one turn (no source dedup) with boolean hasPersisted', async () => {
    const u1 = user('u1', at);
    const r1 = injection('r1', at + 1, u1.id);
    const r2 = injection('r2', at + 2, u1.id);
    // Both rows replay (2 occurrences) and the legacy injector stays silent —
    // proving hasPersisted is a boolean switch, not a per-source dedup list.
    expect(await count([u1, r1, r2])).toBe(2);
  });

  it('fires the legacy injector when no persisted row exists at all', async () => {
    const u1 = user('u1', at);
    expect(await count([u1])).toBe(1);
  });
});
