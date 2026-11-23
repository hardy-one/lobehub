// @vitest-environment node
import { INJECTION_SOURCE_KEYS, isInjectionSourceKey } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { messages, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'message-injection-write-user';
const topicId = 'message-injection-write-topic';

const at = (minute: number) => new Date(Date.UTC(2026, 4, 1, 0, minute));

const messageModel = new MessageModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(topics).values({ id: topicId, userId });
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
});

describe('INJECTION_SOURCE_KEYS', () => {
  it('pins the write-path sources to their canonical values', () => {
    expect(INJECTION_SOURCE_KEYS.MENTION_DELEGATION).toBe('mention_delegation');
    expect(INJECTION_SOURCE_KEYS.SELECTED_SKILL).toBe('selected_skill');
    expect(INJECTION_SOURCE_KEYS.SELECTED_TOOL).toBe('selected_tool');
  });

  it('rejects values outside the canonical table', () => {
    expect(isInjectionSourceKey('todos')).toBe(false);
    expect(isInjectionSourceKey('mention-delegation')).toBe(false);
    expect(isInjectionSourceKey(INJECTION_SOURCE_KEYS.MENTION_DELEGATION)).toBe(true);
  });
});

describe('MessageModel.appendInjectionRow', () => {
  it('persists a legal injected row and returns it', async () => {
    const content = '<mentioned_agents><agent id="agt_1" name="One" /></mentioned_agents>';

    const row = await messageModel.appendInjectionRow(
      topicId,
      INJECTION_SOURCE_KEYS.MENTION_DELEGATION,
      content,
      'user',
      { createdAt: at(2) },
    );

    expect(row).toMatchObject({
      content,
      isInjection: true,
      role: 'user',
      sourceKey: 'mention_delegation',
      topicId,
      userId,
    });
    expect(row.createdAt.toISOString()).toBe(at(2).toISOString());

    const [persisted] = await serverDB.select().from(messages).where(eq(messages.id, row.id));
    expect(persisted).toMatchObject({
      content,
      isInjection: true,
      role: 'user',
      sourceKey: 'mention_delegation',
    });
  });

  it('rejects a source key outside the canonical table without writing', async () => {
    await expect(
      messageModel.appendInjectionRow(topicId, 'todos', 'not a registered source'),
    ).rejects.toThrow('Unknown injection source key: todos');

    const rows = await serverDB.select().from(messages).where(eq(messages.topicId, topicId));
    expect(rows).toHaveLength(0);
  });

  it('enforces the database CHECK constraint both ways', async () => {
    await expect(
      serverDB.insert(messages).values({
        content: 'injection without a source key',
        isInjection: true,
        role: 'user',
        topicId,
        userId,
      }),
    ).rejects.toThrow();

    await expect(
      serverDB.insert(messages).values({
        content: 'real row with a source key',
        isInjection: false,
        role: 'user',
        sourceKey: INJECTION_SOURCE_KEYS.SELECTED_SKILL,
        topicId,
        userId,
      }),
    ).rejects.toThrow();
  });

  it('anchors the row between the user turn and the assistant placeholder', async () => {
    const user = await messageModel.create({
      content: 'delegate this',
      createdAt: at(1).getTime(),
      role: 'user',
      topicId,
    });
    const injection = await messageModel.appendInjectionRow(
      topicId,
      INJECTION_SOURCE_KEYS.MENTION_DELEGATION,
      'delegation context',
      'user',
      { createdAt: user.createdAt.getTime() + 1 },
    );
    const assistant = await messageModel.create({
      content: 'working on it',
      createdAt: user.createdAt.getTime() + 10,
      role: 'assistant',
      topicId,
    });

    const transcript = await messageModel.query({ topicId });
    expect(transcript.map((row) => row.id)).toEqual([user.id, assistant.id]);

    const injected = await messageModel.queryInjectionMessagesByTopic(topicId);
    expect(injected.map((row) => row.id)).toEqual([injection.id]);
    expect(injection.createdAt.getTime()).toBeGreaterThan(user.createdAt.getTime());
    expect(injection.createdAt.getTime()).toBeLessThan(assistant.createdAt.getTime());
  });
});
