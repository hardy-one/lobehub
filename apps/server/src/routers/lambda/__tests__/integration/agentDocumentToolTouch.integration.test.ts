// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { INJECTION_SOURCE_KEYS } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageModel } from '@/database/models/message';

import { agentDocumentRouter } from '../../agentDocument';
import {
  cleanupTestUser,
  createTestAgent,
  createTestContext,
  createTestTopic,
  createTestUser,
} from './setup';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return testDB;
  }),
}));

vi.mock('@/server/services/skill/resource', () => ({
  SkillResourceService: vi.fn().mockImplementation(function () {
    return {
      listResources: vi.fn().mockResolvedValue([]),
      readResource: vi.fn().mockRejectedValue(new Error('Resource not found')),
      storeResources: vi.fn().mockResolvedValue({}),
    };
  }),
}));

const userId = 'agent-document-touch-router-user';
const topicId = 'tpc_agent-document-touch-router';
const turnMessageId = 'agent-document-touch-router-message';
const baseTime = Date.UTC(2026, 7, 1, 0, 0);

const toolContext = {
  messageId: turnMessageId,
  operationId: 'operation-1',
  taskId: null,
  threadId: 'thread-1',
  toolCallId: 'tool-call-1',
  topicId,
};

describe('agentDocument tool-touch injection (real DB)', () => {
  let agentId: string;
  let messageModel: MessageModel;

  beforeEach(async () => {
    testDB = await getTestDB();
    await createTestUser(testDB, userId);
    agentId = await createTestAgent(testDB, userId);
    await createTestTopic(testDB, userId, topicId);
    messageModel = new MessageModel(testDB, userId);
    await messageModel.create({
      clientId: turnMessageId,
      content: 'Create the launch brief',
      createdAt: baseTime,
      role: 'user',
      topicId,
    });
  });

  afterEach(async () => {
    await cleanupTestUser(testDB, userId);
  });

  it('writes a create touch anchored to the user turn', async () => {
    const caller = agentDocumentRouter.createCaller(createTestContext(userId));
    const doc = await caller.createDocument({
      agentId,
      content: 'full document body must not be stored in the injection row',
      title: 'Launch brief',
      toolContext,
      trigger: 'tool',
    });

    expect(doc).toBeDefined();
    const rows = await messageModel.queryInjectionMessagesByTopic(topicId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      isInjection: true,
      sourceKey: INJECTION_SOURCE_KEYS.AGENT_DOC_MESSAGE,
    });
    expect(new Date(rows[0].createdAt).getTime()).toBe(baseTime + 1);
    expect(rows[0].content).toContain('Launch brief');
    expect(rows[0].content).toContain(doc!.id);
    expect(rows[0].content).not.toContain('full document body');
  });

  it('skips tool calls without a topicId', async () => {
    const caller = agentDocumentRouter.createCaller(createTestContext(userId));
    const { topicId: _omitted, ...withoutTopic } = toolContext;

    await caller.createDocument({
      agentId,
      content: 'body',
      title: 'Background brief',
      toolContext: withoutTopic,
      trigger: 'tool',
    });

    expect(await messageModel.queryInjectionMessagesByTopic(topicId)).toEqual([]);
  });

  it('writes edit and delete touches reflecting the operation', async () => {
    const caller = agentDocumentRouter.createCaller(createTestContext(userId));
    const doc = await caller.createDocument({
      agentId,
      content: 'body',
      title: 'Launch brief',
    });

    await caller.replaceDocumentContent({
      agentId,
      content: 'revised body',
      id: doc!.id,
      toolContext,
      trigger: 'tool',
    });
    await caller.removeDocument({
      agentId,
      id: doc!.id,
      toolContext,
      trigger: 'tool',
    });

    const rows = await messageModel.queryInjectionMessagesByTopic(topicId);
    expect(rows).toHaveLength(2);
    expect(rows.some((row) => row.content.includes('edited'))).toBe(true);
    expect(rows.some((row) => row.content.includes('deleted'))).toBe(true);
  });

  it('still succeeds when injection storage fails', async () => {
    const caller = agentDocumentRouter.createCaller(createTestContext(userId));

    const doc = await caller.createDocument({
      agentId,
      content: 'body',
      title: 'Unstoppable brief',
      // An unknown topic makes appendInjectionRow violate the foreign key.
      toolContext: { ...toolContext, topicId: 'tpc_missing_topic' },
      trigger: 'tool',
    });

    expect(doc).toBeDefined();
    expect(await messageModel.queryInjectionMessagesByTopic(topicId)).toEqual([]);
  });
});
