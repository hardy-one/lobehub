// @vitest-environment node
import type { UIChatMessage } from '@lobechat/types';
import { INJECTION_SOURCE_KEYS } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { messages, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';
import { mergeInjectionTimeline } from '../../message/injectionTimeline';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'message-injection-timeline-user';
const otherUserId = 'message-injection-timeline-other-user';
const topicId = 'message-injection-timeline-topic';
const otherTopicId = 'message-injection-timeline-other-topic';

const at = (minute: number) => new Date(Date.UTC(2026, 2, 1, 0, minute));

const messageModel = new MessageModel(serverDB, userId);
const agentDocSourceKey = INJECTION_SOURCE_KEYS.AGENT_DOC_MESSAGE;

const message = (
  id: string,
  createdAt: number,
  extra: Partial<UIChatMessage> = {},
): UIChatMessage => ({
  content: id,
  createdAt,
  id,
  role: 'user',
  ...extra,
});

describe('mergeInjectionTimeline', () => {
  it('uses one createdAt / isInjection / id order regardless of parentId ownership', () => {
    const firstUser = message('first-user', 100);
    const firstAssistant = message('first-assistant', 200, {
      parentId: firstUser.id,
      role: 'assistant',
    });
    const laterUser = message('later-user', 300, { parentId: firstAssistant.id });
    const delayedInjection = message('delayed-injection', 400, {
      isInjection: true,
      parentId: firstUser.id,
    });
    const tiedInjection = message('tied-injection', 300, {
      isInjection: true,
      parentId: laterUser.id,
    });

    expect(
      mergeInjectionTimeline(
        [laterUser, firstAssistant, firstUser],
        [delayedInjection, tiedInjection],
      ).map((row) => row.id),
    ).toEqual([
      'first-user',
      'first-assistant',
      'later-user',
      'tied-injection',
      'delayed-injection',
    ]);
  });

  it('does not pull a child ahead of a parent with a later createdAt', () => {
    const child = message('child', 100, { parentId: 'parent' });
    const parent = message('parent', 200);

    expect(mergeInjectionTimeline([parent], [child]).map((row) => row.id)).toEqual([
      'child',
      'parent',
    ]);
  });

  it('keeps non-injected rows byte-identical to the legacy createdAt / id order', () => {
    const rows = [
      message('legacy-z', 200, { parentId: 'legacy-a', role: 'assistant' }),
      message('legacy-b', 100),
      message('legacy-a', 100),
      message('legacy-c', 200),
    ];
    const snapshot = JSON.stringify(rows);
    const legacyOrder = rows
      .slice()
      .sort(
        (first, second) => first.createdAt - second.createdAt || first.id.localeCompare(second.id),
      );
    const injection = message('legacy-injection', 300, {
      isInjection: true,
      role: 'system',
      sourceKey: agentDocSourceKey,
    });

    const merged = mergeInjectionTimeline(rows, [injection]);

    expect(JSON.stringify(rows)).toBe(snapshot);
    expect(merged.slice(0, rows.length).map((row) => row.id)).toEqual(
      legacyOrder.map((row) => row.id),
    );
    expect(merged.at(-1)).toBe(injection);
  });

  it('returns the original array for empty injections', () => {
    const rows = [message('user', 100), message('assistant', 200, { parentId: 'user' })];

    expect(mergeInjectionTimeline(rows, [])).toBe(rows);
  });
});

/**
 * Injected rows are interleaved with real turns, share timestamps (id is the
 * tie-break), and appear under another topic and another user. The read must
 * return only this topic's injected rows, in `(createdAt, id)` order.
 */
const seed = async () => {
  await serverDB.insert(messages).values([
    {
      content: 'real question',
      createdAt: at(0),
      id: 'real-user',
      role: 'user',
      topicId,
      userId,
    },
    {
      content: 'persisted agent docs',
      createdAt: at(1),
      id: 'inj-agent-doc',
      isInjection: true,
      role: 'system',
      sourceKey: agentDocSourceKey,
      topicId,
      updatedAt: at(1),
      userId,
    },
    {
      content: 'real answer',
      createdAt: at(2),
      id: 'real-assistant',
      role: 'assistant',
      topicId,
      userId,
    },
    {
      content: 'persisted todos b',
      createdAt: at(3),
      id: 'inj-todos-b',
      isInjection: true,
      role: 'user',
      sourceKey: 'todos',
      topicId,
      updatedAt: at(3),
      userId,
    },
    {
      content: 'persisted todos c',
      createdAt: at(3),
      id: 'inj-todos-c',
      isInjection: true,
      role: 'user',
      sourceKey: 'todos',
      topicId,
      updatedAt: at(3),
      userId,
    },
    {
      content: 'other topic injection',
      createdAt: at(4),
      id: 'inj-other-topic',
      isInjection: true,
      role: 'system',
      sourceKey: agentDocSourceKey,
      topicId: otherTopicId,
      updatedAt: at(4),
      userId,
    },
    {
      content: 'other user injection',
      createdAt: at(5),
      id: 'inj-other-user',
      isInjection: true,
      role: 'system',
      sourceKey: agentDocSourceKey,
      topicId,
      updatedAt: at(5),
      userId: otherUserId,
    },
  ]);
};

beforeEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, otherUserId));
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(topics).values([
    { id: topicId, userId },
    { id: otherTopicId, userId },
  ]);
  await seed();
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, otherUserId));
});

describe('MessageModel.queryInjectionMessagesByTopic', () => {
  it('returns only this topic’s injected rows in timeline order', async () => {
    const rows = await messageModel.queryInjectionMessagesByTopic(topicId);

    expect(rows.map((row) => row.id)).toEqual(['inj-agent-doc', 'inj-todos-b', 'inj-todos-c']);
    expect(rows.map((row) => row.createdAt)).toEqual([
      at(1).getTime(),
      at(3).getTime(),
      at(3).getTime(),
    ]);
  });

  it('preserves the stored payload role and source key', async () => {
    const rows = await messageModel.queryInjectionMessagesByTopic(topicId);

    expect(rows).toEqual([
      {
        content: 'persisted agent docs',
        createdAt: at(1).getTime(),
        id: 'inj-agent-doc',
        isInjection: true,
        parentId: undefined,
        role: 'system',
        sourceKey: agentDocSourceKey,
        threadId: undefined,
        updatedAt: at(1).getTime(),
      },
      {
        content: 'persisted todos b',
        createdAt: at(3).getTime(),
        id: 'inj-todos-b',
        isInjection: true,
        parentId: undefined,
        role: 'user',
        sourceKey: 'todos',
        threadId: undefined,
        updatedAt: at(3).getTime(),
      },
      {
        content: 'persisted todos c',
        createdAt: at(3).getTime(),
        id: 'inj-todos-c',
        isInjection: true,
        parentId: undefined,
        role: 'user',
        sourceKey: 'todos',
        threadId: undefined,
        updatedAt: at(3).getTime(),
      },
    ]);
  });

  it('leaves user-facing reads untouched (dual-path boundary)', async () => {
    const transcript = await messageModel.query({ topicId });
    const injected = await messageModel.queryInjectionMessagesByTopic(topicId);

    expect(transcript.map((row) => row.id)).toEqual(['real-user', 'real-assistant']);
    expect(injected.map((row) => row.id)).toEqual(['inj-agent-doc', 'inj-todos-b', 'inj-todos-c']);
  });
});
