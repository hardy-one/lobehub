// @vitest-environment node
import { INJECTION_SOURCE_KEYS } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { messages, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'message-injection-timeline-user';
const otherUserId = 'message-injection-timeline-other-user';
const topicId = 'message-injection-timeline-topic';
const otherTopicId = 'message-injection-timeline-other-topic';

const at = (minute: number) => new Date(Date.UTC(2026, 2, 1, 0, minute));

const messageModel = new MessageModel(serverDB, userId);
const agentDocSourceKey = INJECTION_SOURCE_KEYS.AGENT_DOC_MESSAGE;

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
        role: 'system',
        sourceKey: agentDocSourceKey,
        updatedAt: at(1).getTime(),
      },
      {
        content: 'persisted todos b',
        createdAt: at(3).getTime(),
        id: 'inj-todos-b',
        isInjection: true,
        role: 'user',
        sourceKey: 'todos',
        updatedAt: at(3).getTime(),
      },
      {
        content: 'persisted todos c',
        createdAt: at(3).getTime(),
        id: 'inj-todos-c',
        isInjection: true,
        role: 'user',
        sourceKey: 'todos',
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
