// @vitest-environment node
import { omitToolWorkRegistration } from '@lobechat/agent-runtime';
import type { LobeChatDatabase } from '@lobechat/database';
import { topics, users } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { INJECTION_SOURCE_KEYS } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MessageModel } from '@/database/models/message';

import { ServerMessageTransport } from './ServerMessageTransport';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'server-message-transport-injection-user';
const topicId = 'server-message-transport-injection-topic';
const baseTime = Date.UTC(2026, 4, 3, 0, 0);

const messageModel = new MessageModel(serverDB, userId);
const transport = new ServerMessageTransport(messageModel);

/** The exact read `ServerMessageTransport.query()` performed before the fix. */
const legacyQuery = async (params: { topicId?: string } = {}) =>
  (await messageModel.query(params, { allowShareVisitor: true })).map(omitToolWorkRegistration);

beforeEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(topics).values({ id: topicId, userId });
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
});

describe('ServerMessageTransport.query append-only v2 reads', () => {
  it('replays a persisted injection row at its timeline anchor', async () => {
    const user = await messageModel.create({
      content: 'Ask @Delegate to audit this screen',
      createdAt: baseTime,
      role: 'user',
      topicId,
    });
    const injection = await messageModel.appendInjectionRow(
      topicId,
      INJECTION_SOURCE_KEYS.MENTION_DELEGATION,
      '<mentioned_agents><agent id="agt_delegate" name="Delegate" /></mentioned_agents>',
      'user',
      // Written at the user turn's millisecond on purpose: the tie-break must
      // keep the conversation row first and the injected context second.
      { createdAt: user.createdAt.getTime() },
    );
    const answer = await messageModel.create({
      content: 'Delegated answer',
      createdAt: baseTime + 10,
      parentId: user.id,
      role: 'assistant',
      topicId,
    });

    const messages = await transport.query({ topicId });

    expect(messages.map((message) => message.id)).toEqual([user.id, injection.id, answer.id]);
    expect(messages[1]).toMatchObject({
      content: '<mentioned_agents><agent id="agt_delegate" name="Delegate" /></mentioned_agents>',
      isInjection: true,
      role: 'user',
      sourceKey: INJECTION_SOURCE_KEYS.MENTION_DELEGATION,
    });

    // The user-facing read keeps its `notInjection()` guard.
    const transcript = await messageModel.query({ topicId });
    expect(transcript.map((message) => message.id)).toEqual([user.id, answer.id]);
  });

  it('returns the pre-change output byte-for-byte when the topic has no injected rows', async () => {
    const user = await messageModel.create({
      content: 'plain turn',
      createdAt: baseTime,
      role: 'user',
      topicId,
    });
    await messageModel.create({
      content: 'plain answer',
      createdAt: baseTime + 10,
      parentId: user.id,
      role: 'assistant',
      topicId,
    });

    const actual = await transport.query({ topicId });
    const legacy = await legacyQuery({ topicId });

    expect(JSON.stringify(actual)).toBe(JSON.stringify(legacy));
  });

  it('keeps the conversation-only read when params carry no topicId', async () => {
    const topicless = await messageModel.create({
      content: 'topic-less turn',
      createdAt: baseTime,
      role: 'user',
    });
    await messageModel.create({
      content: 'in-topic turn',
      createdAt: baseTime + 1,
      role: 'user',
      topicId,
    });
    const injection = await messageModel.appendInjectionRow(
      topicId,
      INJECTION_SOURCE_KEYS.SELECTED_TOOL,
      '<selected_tools><tool id="web-browse" /></selected_tools>',
      'user',
      { createdAt: baseTime + 2 },
    );

    const actual = await transport.query({});
    const legacy = await legacyQuery();

    expect(JSON.stringify(actual)).toBe(JSON.stringify(legacy));
    expect(actual.map((message) => message.id)).toEqual([topicless.id]);
    expect(actual.some((message) => message.id === injection.id)).toBe(false);

    // Contrast: the same row is replayed once the read is topic-scoped.
    const scoped = await transport.query({ topicId });
    expect(scoped.some((message) => message.id === injection.id)).toBe(true);
  });
});
