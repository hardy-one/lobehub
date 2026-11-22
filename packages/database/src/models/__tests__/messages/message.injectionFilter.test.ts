// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { messages, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';
import { TopicModel } from '../../topic';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'message-injection-filter-user';
const topicId = 'message-injection-filter-topic';

const at = (minute: number) => new Date(Date.UTC(2026, 2, 1, 0, minute));

const messageModel = new MessageModel(serverDB, userId);

/**
 * Every UI-facing read must return the real transcript only. The injected row
 * is deliberately the NEWEST `user` rows so an unfiltered query would surface
 * it in both the transcript and the round cursor window.
 */
const seed = async () => {
  await serverDB.insert(messages).values([
    {
      content: 'injected todos context',
      createdAt: at(0),
      id: 'inj-early-user',
      isInjection: true,
      role: 'user',
      sourceKey: 'todos',
      topicId,
      userId,
    },
    {
      content: 'real question',
      createdAt: at(1),
      id: 'real-user',
      role: 'user',
      topicId,
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
      content: 'injected todos refresh',
      createdAt: at(3),
      id: 'inj-late-user',
      isInjection: true,
      role: 'user',
      sourceKey: 'todos',
      topicId,
      userId,
    },
    {
      content: 'injected assistant context',
      createdAt: at(4),
      id: 'inj-late-assistant',
      isInjection: true,
      role: 'assistant',
      sourceKey: 'todos',
      topicId,
      userId,
    },
  ]);
};

beforeEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(topics).values({ id: topicId, userId });
  await seed();
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
});

describe('MessageModel injection filtering on user-facing reads', () => {
  it('query returns only real conversation rows', async () => {
    const rows = await messageModel.query({ topicId });

    expect(rows.map((row) => row.id)).toEqual(['real-user', 'real-assistant']);
  });

  it('queryWithWhere returns only real conversation rows', async () => {
    const rows = await messageModel.queryWithWhere({ topicId });

    expect(rows.map((row) => row.id)).toEqual(['real-user', 'real-assistant']);
  });

  it('queryForVisitor strips injected rows before the visitor projection', async () => {
    const rows = await messageModel.queryForVisitor({ topicId });

    expect(rows.map((row) => row.id)).toEqual(['real-user', 'real-assistant']);
  });

  it('queryTopicMessagesByCursor neither returns nor round-counts injected rows', async () => {
    const page = await messageModel.queryTopicMessagesByCursor({
      roundLimit: 1,
      topicId,
    });

    // The late injected `user` row must not split the round: the whole real
    // round is returned and no injected row is included.
    expect(page.messages.map((row) => row.id)).toEqual(['real-user', 'real-assistant']);
    expect(page.hasMore).toBe(false);
  });

  it('queryTopicTranscript omits injected rows from items and total', async () => {
    const transcript = await messageModel.queryTopicTranscript({ limit: 100, offset: 0, topicId });

    expect(transcript.items.map((row) => row.id)).toEqual(['real-user', 'real-assistant']);
    expect(transcript.total).toBe(2);
  });

  it('searchInTopic skips injected matches', async () => {
    const matches = await messageModel.searchInTopic({ keyword: 'injected', topicId });

    expect(matches).toEqual([]);
  });

  it('queryByKeyword skips injected matches', async () => {
    const model = new MessageModel(serverDB, userId, undefined, {
      ftsSearchCandidateEnabled: true,
      ftsSearchCandidates: async () => ({
        candidates: ['inj-early-user', 'real-user', 'real-assistant'].map((id) => ({
          id,
          score: 1,
        })),
        total: 3,
      }),
    });

    const rows = await model.queryByKeyword('injected');

    expect(rows.map((row) => row.id)).toEqual(['real-assistant', 'real-user']);
  });

  it('searchByKeyword skips injected matches', async () => {
    const model = new MessageModel(serverDB, userId, undefined, {
      ftsSearchCandidateEnabled: true,
      ftsSearchCandidates: async () => ({
        candidates: ['inj-early-user', 'real-user', 'real-assistant'].map((id) => ({
          id,
          score: 1,
        })),
        total: 3,
      }),
    });

    const result = await model.searchByKeyword({ keyword: 'injected' });

    expect(result.items.map((row) => row.id)).toEqual(['real-assistant', 'real-user']);
  });
});

describe('engine-side reads still see injected rows', () => {
  it('queryLastUserMessageByTopics keeps the latest injected user row', async () => {
    const latest = await messageModel.queryLastUserMessageByTopics([topicId]);

    expect(latest.get(topicId)).toBe('injected todos refresh');
  });

  it('queryByIds still hydrates an injected row for engine assembly', async () => {
    const rows = await messageModel.queryByIds(['inj-early-user']);

    expect(rows.map((row) => row.id)).toEqual(['inj-early-user']);
  });
});

describe('topic previews hide injected rows', () => {
  it('picks the real first user message for withDetails', async () => {
    const topicModel = new TopicModel(serverDB, userId);

    const result = await topicModel.query({ withDetails: true });

    const item = result.items[0] as Record<string, unknown>;
    // The injected `user` row is older, so an unfiltered subquery would pick it.
    expect(item.firstUserMessage).toBe('real question');
  });

  it('picks the real last assistant message for the topic list', async () => {
    const topicModel = new TopicModel(serverDB, userId);

    const result = await topicModel.queryTopics({ withLastMessage: true });
    const topic = result.find((item) => item.id === topicId);

    // The injected assistant row is newer, so an unfiltered subquery would pick it.
    expect(topic?.lastAssistantMessage).toBe('real answer');
  });
});
