// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { topics, users } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { INJECTION_SOURCE_KEYS } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageModel } from '@/database/models/message';

import {
  captureAgentDocumentTouch,
  captureAgentDocumentTouchSafely,
  formatAgentDocumentTouch,
} from '../agentDocumentTouchCapture';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'agent-document-touch-user';
const topicId = 'agent-document-touch-topic';
const baseTime = Date.UTC(2026, 6, 1, 0, 0);

const messageModel = new MessageModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(topics).values({ id: topicId, userId });
  await messageModel.create({
    clientId: 'tool-turn-message',
    content: 'Write an audit brief',
    createdAt: baseTime,
    role: 'user',
    topicId,
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await serverDB.delete(users).where(eq(users.id, userId));
});

describe('agent document touch injection rows', () => {
  it('persists a create touch anchored to the user turn', async () => {
    const row = await captureAgentDocumentTouch({
      agentDocumentId: 'doc-1',
      clientMessageId: 'tool-turn-message',
      kind: 'created',
      messageModel,
      title: 'Audit brief',
      topicId,
    });

    expect(row).toMatchObject({
      content: formatAgentDocumentTouch({
        agentDocumentId: 'doc-1',
        kind: 'created',
        title: 'Audit brief',
      }),
      createdAt: expect.any(Date),
      isInjection: true,
      sourceKey: INJECTION_SOURCE_KEYS.AGENT_DOC_MESSAGE,
    });
    if (!row) throw new Error('expected a persisted touch row');
    expect(row.createdAt.getTime()).toBe(baseTime);
    expect(row.content).toContain('Audit brief');
    expect(row.content).toContain('doc-1');
    expect(row.content).toContain('created');
    expect(row.content.length).toBeLessThan(500);

    const injected = await messageModel.queryInjectionMessagesByTopic(topicId);
    expect(injected.map((item) => item.id)).toEqual([row.id]);
    expect((await messageModel.query({ topicId })).map((item) => item.content)).toEqual([
      'Write an audit brief',
    ]);
  });

  it('skips calls without a topicId', async () => {
    const row = await captureAgentDocumentTouchSafely({
      agentDocumentId: 'doc-1',
      clientMessageId: 'tool-turn-message',
      kind: 'created',
      messageModel,
      title: 'Audit brief',
    });

    expect(row).toBeUndefined();
    expect(await messageModel.queryInjectionMessagesByTopic(topicId)).toEqual([]);
  });

  it('records edit and delete touches as separate deterministic rows', async () => {
    const edited = await captureAgentDocumentTouch({
      agentDocumentId: 'doc-1',
      anchorCreatedAt: baseTime + 1,
      kind: 'edited',
      messageModel,
      title: 'Audit brief',
      topicId,
    });
    const deleted = await captureAgentDocumentTouch({
      agentDocumentId: 'doc-1',
      anchorCreatedAt: baseTime + 2,
      kind: 'deleted',
      messageModel,
      title: 'Audit brief',
      topicId,
    });

    if (!edited || !deleted) throw new Error('expected persisted touch rows');
    expect(edited.content).toContain('edited');
    expect(deleted.content).toContain('deleted');
    expect(edited.content).toBe(
      formatAgentDocumentTouch({
        agentDocumentId: 'doc-1',
        kind: 'edited',
        title: 'Audit brief',
      }),
    );
    expect(deleted.createdAt.getTime()).toBe(baseTime + 2);
    expect(
      (await messageModel.queryInjectionMessagesByTopic(topicId)).map((row) => row.id),
    ).toEqual([edited.id, deleted.id]);
  });

  it('swallows a storage failure without throwing', async () => {
    const error = new Error('constraint conflict');
    vi.spyOn(messageModel, 'appendInjectionRow').mockRejectedValue(error);

    await expect(
      captureAgentDocumentTouchSafely({
        agentDocumentId: 'doc-1',
        clientMessageId: 'tool-turn-message',
        kind: 'created',
        messageModel,
        title: 'Audit brief',
        topicId,
      }),
    ).resolves.toBeUndefined();
    expect(messageModel.appendInjectionRow).toHaveBeenCalled();
  });

  it('anchors a runtime message id through findById', async () => {
    const user = await messageModel.create({
      content: 'Runtime turn',
      createdAt: baseTime + 5,
      role: 'user',
      topicId,
    });

    const row = await captureAgentDocumentTouch({
      agentDocumentId: 'doc-runtime',
      kind: 'created',
      messageId: user.id,
      messageModel,
      title: 'Runtime brief',
      topicId,
    });

    if (!row) throw new Error('expected a persisted touch row');
    expect(row.createdAt.getTime()).toBe(baseTime + 5);
  });

  it('falls back to the current time when no message row matches', async () => {
    const before = Date.now();
    const row = await captureAgentDocumentTouch({
      agentDocumentId: 'doc-orphan',
      kind: 'created',
      messageId: 'msg-missing',
      messageModel,
      topicId,
    });

    if (!row) throw new Error('expected a persisted touch row');
    expect(row.createdAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(row.createdAt.getTime()).toBeLessThanOrEqual(Date.now());
  });
});
