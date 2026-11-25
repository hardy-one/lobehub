// @vitest-environment node
import {
  formatMentionedAgentsContext,
  MessagesEngine,
  type MessagesEngineParams,
} from '@lobechat/context-engine';
import type { LobeChatDatabase } from '@lobechat/database';
import { messages, threads, topics, users } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import type { RuntimeMentionedAgent, UIChatMessage } from '@lobechat/types';
import { INJECTION_SOURCE_KEYS } from '@lobechat/types';
import debug from 'debug';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageModel } from '@/database/models/message';

import { captureMessageInjections } from '../messageInjectionCapture';

/**
 * Batch 0-C2 frozen-contract EVIDENCE suite (real pglite).
 *
 * Supplements the a-h matrix with the four proof classes the contract requires
 * but the matrix did not print as row-level / raw-log artifacts:
 *  E1 row-level DB output + the single total order, including equal-createdAt
 *     ties (isInjection ASC then id ASC);
 *  E2 the actual debug log line emitted when a parentId=null row is accepted
 *     by the [turn, turn+64) window (captured from process.stderr);
 *  E3 parentId=null boundary + historical parentId rows, with explicit
 *     expected/actual marker counts;
 *  E4 threadId inherited from the real user anchor + same-source multi-row
 *     replay (hasPersisted is a boolean, no per-source dedup).
 *
 * NOTE on types: `queryForModelInput` returns real conversation rows with a
 * Date-valued createdAt, while injected rows and the UIChatMessage type use a
 * number. `asEngineTimeline` normalizes real rows to numbers before feeding the
 * engine so the engine sees the UIChatMessage shape it declares. The raw row
 * shapes are printed verbatim in E1 for audit.
 */
const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'turn-scoped-contract-evidence-user';
const topicId = 'turn-scoped-contract-evidence-topic';
const baseTime = Date.UTC(2026, 5, 2, 0, 0, 0);

const B1 = INJECTION_SOURCE_KEYS.MENTION_DELEGATION;
const L5 = INJECTION_SOURCE_KEYS.SELECTED_SKILL;
const L6 = INJECTION_SOURCE_KEYS.SELECTED_TOOL;
const mentionedAgents: RuntimeMentionedAgent[] = [{ id: 'agt_delegate', name: 'Delegate' }];

const messageModel = new MessageModel(serverDB, userId);

const occurrences = (serialized: string, marker: string) =>
  serialized.match(new RegExp(marker, 'g'))?.length ?? 0;

const runEngine = async (timeline: UIChatMessage[]): Promise<string> => {
  const result = await new MessagesEngine({
    agentManagementContext: { mentionedAgents },
    enableSystemDate: false,
    messages: timeline,
    model: 'gpt-4',
    provider: 'openai',
    systemRole: 'You are a helpful assistant.',
  }).process();
  return JSON.stringify(result.messages);
};

const createUser = (
  content: string,
  createdAt: number,
  opts: { parentId?: string; threadId?: string } = {},
) =>
  messageModel.create({
    content,
    createdAt,
    parentId: opts.parentId,
    role: 'user',
    threadId: opts.threadId,
    topicId,
  });

const clearMessages = () => serverDB.delete(messages).where(eq(messages.topicId, topicId));

type PrintRow = {
  createdAt: number;
  createdAtRawType: string;
  id: string;
  isInjection: boolean;
  parentId: string | null;
  role: string;
  sourceKey: string | null;
  threadId: string | null;
};

const rowView = (row: any): PrintRow => ({
  createdAt: typeof row.createdAt === 'number' ? row.createdAt : row.createdAt.getTime(),
  createdAtRawType: typeof row.createdAt,
  id: row.id,
  isInjection: !!row.isInjection,
  parentId: row.parentId ?? null,
  role: row.role,
  sourceKey: row.sourceKey ?? null,
  threadId: row.threadId ?? null,
});

/** Normalize DB rows to the UIChatMessage shape the engine declares. */
const asEngineTimeline = (rows: any[]): UIChatMessage[] =>
  rows.map((row) => ({
    content: row.content ?? '',
    createdAt: rowView(row).createdAt,
    id: row.id,
    isInjection: !!row.isInjection,
    parentId: row.parentId ?? undefined,
    role: row.role,
    sourceKey: row.sourceKey ?? undefined,
    threadId: row.threadId ?? undefined,
    updatedAt: rowView(row).createdAt,
  })) as UIChatMessage[];

const appendB1 = (opts: { anchorMessageId?: string; createdAt: number }) =>
  messageModel.appendInjectionRow(
    topicId,
    B1,
    formatMentionedAgentsContext(mentionedAgents),
    'user',
    opts,
  );

beforeEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(topics).values({ id: topicId, userId });
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
});

describe('Batch 0-C2 frozen-contract evidence (real pglite, row-level)', () => {
  it('E1 row-level DB output and total order (createdAt, isInjection, id) incl. equal-createdAt ties', async () => {
    const user = await createUser('same-ms turn', baseTime);
    const i1 = await appendB1({ anchorMessageId: user.id, createdAt: baseTime });
    const i2 = await messageModel.appendInjectionRow(topicId, L5, 'l5', 'user', {
      anchorMessageId: user.id,
      createdAt: baseTime,
    });
    const i3 = await messageModel.appendInjectionRow(topicId, L6, 'l6', 'user', {
      anchorMessageId: user.id,
      createdAt: baseTime,
    });

    const rows = await messageModel.queryForModelInput({ topicId });
    const printed = rows.map(rowView);
    console.log(
      '[E1 rows sourceKey/parentId/threadId/createdAt/isInjection]',
      JSON.stringify(printed),
    );
    const expectedOrder = [user.id, ...[i1.id, i2.id, i3.id].sort((a, b) => a.localeCompare(b))];
    console.log(
      '[E1 order expected (createdAt ASC, isInjection ASC, id ASC)]',
      JSON.stringify(expectedOrder),
    );
    console.log('[E1 order actual]', JSON.stringify(rows.map((r) => r.id)));

    expect(rows.map((r) => r.id)).toEqual(expectedOrder);
    expect(new Set(printed.map((r) => r.createdAt))).toEqual(new Set([baseTime]));
    expect(printed[0].isInjection).toBe(false);
    expect(printed.slice(1).every((r) => r.isInjection)).toBe(true);
  });

  it('E2 debug log captured for parentId=null row inside [turn, turn+64)', async () => {
    await createUser('current', baseTime);
    await appendB1({ createdAt: baseTime }); // parentId=null, offset 0 -> inside window
    const timeline = asEngineTimeline(await messageModel.queryForModelInput({ topicId }));

    const captured: string[] = [];
    const original = debug.enable('context-engine:MessagesEngine');
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
      captured.push(String(chunk));
      return true as any;
    });
    let serialized = '';
    try {
      serialized = await runEngine(timeline);
    } finally {
      spy.mockRestore();
      debug.enable(original ?? '');
    }

    const windowLogs = captured.filter((line) =>
      line.includes('current-turn legacy injection row'),
    );
    console.log('[E2 debug window logs]', JSON.stringify(windowLogs));
    expect(windowLogs.length).toBeGreaterThan(0);
    expect(
      windowLogs.some((line) => line.includes('createdAt window') && line.includes('+64)')),
    ).toBe(true);
    const actual = occurrences(serialized, '<mentioned_agents>');
    console.log('[E2 marker] B1 expected=1 actual=', actual);
    expect(actual).toBe(1);
  });

  it('E3 null-parent boundary + historical parentId rows: expected/actual marker counts', async () => {
    // Inside +63 -> hasPersisted -> replay only -> marker 1.
    await createUser('t1', baseTime);
    await appendB1({ createdAt: baseTime + 63 });
    const s1 = await runEngine(
      asEngineTimeline(await messageModel.queryForModelInput({ topicId })),
    );

    // Outside +64 (right-open) -> history -> legacy re-fires -> marker 2.
    await clearMessages();
    await createUser('t2', baseTime);
    await appendB1({ createdAt: baseTime + 64 });
    const s2 = await runEngine(
      asEngineTimeline(await messageModel.queryForModelInput({ topicId })),
    );

    // Row anchored to an OLD user is history for the current turn: replay only,
    // never part of current hasPersisted -> live need re-fires legacy -> marker 2.
    await clearMessages();
    const oldUser = await createUser('old', baseTime);
    await appendB1({ anchorMessageId: oldUser.id, createdAt: baseTime + 1 });
    await createUser('current', baseTime + 1000);
    const s3 = await runEngine(
      asEngineTimeline(await messageModel.queryForModelInput({ topicId })),
    );

    const cases = [
      {
        actual: occurrences(s1, '<mentioned_agents>'),
        expected: 1,
        label: 'null-parent +63 (inside window)',
      },
      {
        actual: occurrences(s2, '<mentioned_agents>'),
        expected: 2,
        label: 'null-parent +64 (right-open, outside)',
      },
      {
        actual: occurrences(s3, '<mentioned_agents>'),
        expected: 2,
        label: 'historical parentId row, live need re-fires',
      },
    ];
    console.log('[E3 marker expected/actual]', JSON.stringify(cases));
    for (const c of cases) expect(c.actual).toBe(c.expected);
  });

  it('E4 threadId inherited from real user anchor + same-source multi-row not deduped', async () => {
    // Thread inheritance: injected row must carry the real user anchor's thread.
    await serverDB.insert(threads).values({
      id: 'evidence-thread',
      topicId,
      type: 'continuation',
      userId,
    });
    const anchor = await createUser('thread ask', baseTime, { threadId: 'evidence-thread' });
    const cap = await captureMessageInjections({
      anchorMessageId: anchor.id,
      anchorCreatedAt: baseTime,
      mentionedAgents,
      messageModel,
      topicId,
    });
    const threadRows = await messageModel.queryInjectionMessagesByTopicAndThread(
      topicId,
      'evidence-thread',
    );
    console.log(
      '[E4 injected anchor/thread/source]',
      JSON.stringify(
        threadRows.map((r) => ({
          parentId: r.parentId,
          sourceKey: r.sourceKey,
          threadId: r.threadId,
        })),
      ),
    );
    expect(threadRows).toHaveLength(1);
    expect(threadRows[0].parentId).toBe(anchor.id);
    expect(threadRows[0].threadId).toBe('evidence-thread');
    expect(cap.written[0].sourceKey).toBe(B1);

    // No-dedup: two B1 rows on the same turn both replay, legacy stays silent.
    // Use a threadless user so queryForModelInput({topicId}) returns the rows.
    await clearMessages();
    const plain = await createUser('plain ask', baseTime);
    await appendB1({ anchorMessageId: plain.id, createdAt: baseTime });
    await appendB1({ anchorMessageId: plain.id, createdAt: baseTime + 1 });
    const rows = await messageModel.queryForModelInput({ topicId });
    console.log(
      '[E4 rows sourceKey/parentId/threadId/createdAt/isInjection]',
      JSON.stringify(rows.map(rowView)),
    );
    const serialized = await runEngine(asEngineTimeline(rows));
    const expected = 2; // two replayed rows, legacy silent
    const actual = occurrences(serialized, '<mentioned_agents>');
    console.log(
      '[E4 same-source multi-row marker] expected=',
      expected,
      'actual=',
      actual,
      '(2 replayed rows, legacy silent => hasPersisted is boolean, no source dedup)',
    );
    expect(actual).toBe(expected);
  });
});
