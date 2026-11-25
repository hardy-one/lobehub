// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { topics, users } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { INJECTION_SOURCE_KEYS } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageModel } from '@/database/models/message';

import { agentDocumentsRuntime } from '../agentDocuments';

const serverDB: LobeChatDatabase = await getTestDB();
const createDocument = vi.fn();
const createForTopic = vi.fn();

vi.mock('@/server/services/agentDocuments', () => ({
  AgentDocumentsService: vi.fn().mockImplementation(function () {
    return { createDocument, createForTopic };
  }),
}));
vi.mock('@/server/services/agentDocuments/documentWork', () => ({
  createDocumentWorkRegistrar: vi.fn().mockReturnValue({}),
}));
vi.mock('@/server/services/agentDocuments/toolOutcome', () => ({
  emitAgentDocumentToolOutcomeSafely: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/database/models/task', () => ({ TaskModel: vi.fn() }));
vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://app.example.com' } }));

const userId = 'agent-documents-touch-runtime-user';
const topicId = 'tpc_agent-documents-touch-runtime';
const messageModel = new MessageModel(serverDB, userId);
const baseTime = Date.UTC(2026, 8, 1, 0, 0);

beforeEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(topics).values({ id: topicId, userId });
  createDocument.mockReset();
  createDocument.mockResolvedValue({ id: 'doc-runtime', title: 'Runtime brief' });
  createForTopic.mockReset();
  createForTopic.mockResolvedValue({ id: 'doc-share', title: 'Share brief' });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await serverDB.delete(users).where(eq(users.id, userId));
});

describe('agentDocumentsRuntime document touch injection (real DB)', () => {
  it('persists a create touch anchored to the runtime source message', async () => {
    const user = await messageModel.create({
      content: 'Create a runtime brief',
      createdAt: baseTime,
      role: 'user',
      topicId,
    });

    const runtime = agentDocumentsRuntime.factory({
      messageId: user.id,
      serverDB,
      toolManifestMap: {},
      topicId,
      userId,
    });
    const result = await runtime.createDocument(
      { content: 'full body stays in the tool result', title: 'Runtime brief' },
      { agentId: 'agent-1' },
    );

    expect(result.success).toBe(true);
    const rows = await messageModel.queryInjectionMessagesByTopic(topicId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      isInjection: true,
      sourceKey: INJECTION_SOURCE_KEYS.AGENT_DOC_MESSAGE,
    });
    expect(new Date(rows[0].createdAt).getTime()).toBe(baseTime + 1);
    expect(rows[0].content).toContain('Runtime brief');
    expect(rows[0].content).toContain('doc-runtime');
    expect(rows[0].content).not.toContain('full body stays in the tool result');
  });

  it('uses shareTopicId for a share visitor touch', async () => {
    const runtime = agentDocumentsRuntime.factory({
      agentShareVisitor: {
        agentId: 'agent-1',
        shareId: 'share-1',
        visitorUserId: 'visitor-1',
      },
      messageId: 'msg-visitor',
      serverDB,
      toolManifestMap: {},
      topicId,
      userId,
    });

    await runtime.createDocument({ content: 'body', title: 'Share brief' }, { agentId: 'agent-1' });

    const rows = await messageModel.queryInjectionMessagesByTopic(topicId);
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toContain('Share brief');
    expect(rows[0].content).toContain('doc-share');
  });
});
