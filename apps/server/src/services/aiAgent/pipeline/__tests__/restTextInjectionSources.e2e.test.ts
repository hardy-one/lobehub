// @vitest-environment node
import {
  formatMessageContextSelections,
  MessagesEngine,
  type MessagesEngineParams,
} from '@lobechat/context-engine';
import { formatAgentDocumentChanges } from '@lobechat/context-engine/agent-document';
import type { LobeChatDatabase } from '@lobechat/database';
import { threads, topics, users } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import type { ContextSelection, UIChatMessage } from '@lobechat/types';
import { INJECTION_SOURCE_KEYS } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MessageModel } from '@/database/models/message';

import { captureAgentDocumentChanges } from '../agentDocumentChangesCapture';
import { captureMessageInjections } from '../messageInjectionCapture';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'rest-text-injection-sources-user';
const topicId = 'rest-text-injection-sources-topic';
const baseTime = Date.UTC(2026, 6, 1);
const messageModel = new MessageModel(serverDB, userId);

const changes = [
  {
    contentCharCount: 2300,
    folderTitle: 'Plans',
    id: 'doc-launch-plan',
    kind: 'created' as const,
    title: 'Launch plan',
    updatedAt: '2026-11-14T10:01:30.000Z',
  },
  {
    id: 'doc-old-draft',
    kind: 'deleted' as const,
    title: 'Old draft',
  },
];
const contextSelections: ContextSelection[] = [
  {
    content: 'const value = 1;\nconsole.log(value);',
    filePath: 'src/example.ts',
    id: 'selection-code',
    language: 'ts',
    lineRange: { endLine: 12, startLine: 12 },
    source: 'code',
    title: 'example.ts',
  },
  {
    content: 'a<b\n  and c>d',
    id: 'selection-text',
    source: 'text',
    title: 'Escaped <text>',
  },
];

const documentChangesContent = formatAgentDocumentChanges(changes);
const contextSelectionsContent = formatMessageContextSelections(contextSelections, true)!;

const engineParams = (
  timeline: UIChatMessage[],
  extra: Partial<MessagesEngineParams> = {},
): MessagesEngineParams => ({
  enableMcpAppContext: true,
  enableSystemDate: false,
  messages: timeline,
  model: 'gpt-4',
  provider: 'openai',
  systemRole: 'You are a helpful assistant.',
  ...extra,
});

const occurrences = (serialized: string, marker: string) =>
  serialized.match(new RegExp(marker, 'g'))?.length ?? 0;

const captureSources = async (anchor: { id: string }) =>
  captureMessageInjections({
    anchorCreatedAt: baseTime + 1,
    anchorMessageId: anchor.id,
    contextSelections,
    mcpAppsEnabled: true,
    messageModel,
    topicId,
  });

beforeEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(topics).values({ id: topicId, userId });
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
});

describe('append-only v2 rest text sources (real pglite)', () => {
  it('persists context selections byte-identically and replays them between the real user and assistant rows', async () => {
    const user = await messageModel.create({
      content: 'Review these selections',
      createdAt: baseTime,
      metadata: { contextSelections },
      role: 'user',
      topicId,
    });
    const assistant = await messageModel.create({
      content: 'Review complete',
      createdAt: baseTime + 10,
      parentId: user.id,
      role: 'assistant',
      topicId,
    });

    const { written } = await captureSources(user);
    expect(written).toHaveLength(1);
    expect(written[0].sourceKey).toBe(INJECTION_SOURCE_KEYS.CONTEXT_SELECTIONS);
    expect(
      Buffer.compare(Buffer.from(written[0].content), Buffer.from(contextSelectionsContent)),
    ).toBe(0);
    expect(written[0].parentId).toBe(user.id);

    const timeline = await messageModel.queryForModelInput({ topicId });
    expect(timeline.map((row) => row.id)).toEqual([user.id, written[0].id, assistant.id]);
    expect(written[0].createdAt.getTime()).toBe(baseTime + 1);

    const result = await new MessagesEngine(engineParams(timeline)).process();
    const serialized = JSON.stringify(result.messages);
    expect(occurrences(serialized, '<user_context_selections')).toBe(1);
    expect(
      result.messages.some(
        (message) =>
          typeof message.content === 'string' && message.content === contextSelectionsContent,
      ),
    ).toBe(true);

    const userIndex = result.messages.findIndex((message) => message.content === user.content);
    const selectionIndex = result.messages.findIndex((message) =>
      typeof message.content === 'string'
        ? message.content.includes(contextSelectionsContent)
        : false,
    );
    const assistantIndex = result.messages.findIndex(
      (message) => message.content === assistant.content,
    );
    expect(userIndex).toBeGreaterThanOrEqual(0);
    expect(selectionIndex).toBeGreaterThan(userIndex);
    expect(selectionIndex).toBeLessThan(assistantIndex);
  });

  it('persists agent-document changes byte-identically at the real turn timestamp and never double-injects', async () => {
    const user = await messageModel.create({
      content: 'What changed in my documents?',
      createdAt: baseTime,
      role: 'user',
      topicId,
    });
    const assistant = await messageModel.create({
      content: 'Here is the change summary',
      createdAt: baseTime + 10,
      parentId: user.id,
      role: 'assistant',
      topicId,
    });

    await captureAgentDocumentChanges({
      agentDocumentChanges: { [user.id]: changes },
      messageModel,
      topicId,
      userMessageId: user.id,
    });

    const injected = await messageModel.queryInjectionMessagesByTopic(topicId);
    expect(injected).toHaveLength(1);
    expect(injected[0].sourceKey).toBe(INJECTION_SOURCE_KEYS.AGENT_DOC_CHANGES);
    expect(
      Buffer.compare(Buffer.from(injected[0].content!), Buffer.from(documentChangesContent)),
    ).toBe(0);
    expect(injected[0].createdAt).toBe(baseTime);
    expect(injected[0].parentId).toBe(user.id);

    const timeline = await messageModel.queryForModelInput({ topicId });
    expect(timeline.map((row) => row.id)).toEqual([user.id, injected[0].id, assistant.id]);

    const result = await new MessagesEngine(
      engineParams(timeline, { agentDocumentChanges: { [user.id]: changes } }),
    ).process();
    const serialized = JSON.stringify(result.messages);
    expect(occurrences(serialized, '<agent_documents_changes>')).toBe(0);
    expect(occurrences(serialized, 'Agent documents changed since')).toBe(1);
    expect(
      result.messages.some(
        (message) =>
          typeof message.content === 'string' && message.content === documentChangesContent,
      ),
    ).toBe(true);
  });

  it('inherits the real user turn thread for both persisted sources', async () => {
    const threadId = 'rest-text-injection-thread';
    await serverDB.insert(threads).values({
      id: threadId,
      topicId,
      type: 'continuation',
      userId,
    });
    const user = await messageModel.create({
      content: 'Thread question',
      createdAt: baseTime,
      role: 'user',
      threadId,
      topicId,
    });

    const { written } = await captureSources(user);
    await captureAgentDocumentChanges({
      agentDocumentChanges: { [user.id]: changes },
      messageModel,
      topicId,
      userMessageId: user.id,
    });

    const injected = await messageModel.queryInjectionMessagesByTopic(topicId);
    expect(injected.map((row) => row.sourceKey)).toEqual([
      INJECTION_SOURCE_KEYS.AGENT_DOC_CHANGES,
      INJECTION_SOURCE_KEYS.CONTEXT_SELECTIONS,
    ]);
    expect(injected.map((row) => row.threadId)).toEqual([threadId, threadId]);
    expect(injected.map((row) => row.parentId)).toEqual([user.id, user.id]);
    expect(written).toHaveLength(1);
  });

  it('skips both sources without a topic and preserves a failed source while the other still writes', async () => {
    const user = await messageModel.create({
      content: 'Fail-open question',
      createdAt: baseTime,
      role: 'user',
      topicId,
    });

    await captureMessageInjections({
      anchorMessageId: user.id,
      contextSelections,
      messageModel,
      topicId: undefined as never,
    });
    await captureAgentDocumentChanges({
      agentDocumentChanges: { [user.id]: changes },
      messageModel,
      topicId: undefined,
      userMessageId: user.id,
    });
    expect(await messageModel.queryInjectionMessagesByTopic(topicId)).toHaveLength(0);

    const failingModel: Pick<MessageModel, 'appendInjectionRow' | 'findById'> = {
      appendInjectionRow: async (
        failedTopicId: string,
        sourceKey: string,
        content: string,
        role = 'user',
        options = {},
      ) => {
        if (sourceKey === INJECTION_SOURCE_KEYS.CONTEXT_SELECTIONS) {
          throw new Error('forced context-selection writer failure');
        }
        return messageModel.appendInjectionRow(failedTopicId, sourceKey, content, role, options);
      },
      findById: (id: string) => messageModel.findById(id),
    };
    const result = await captureMessageInjections({
      anchorMessageId: user.id,
      contextSelections,
      messageModel: failingModel,
      mentionedAgents: [{ id: 'agt_delegate', name: 'Delegate' }],
      topicId,
    });

    expect(result.written.map((row) => row.sourceKey)).toEqual([
      INJECTION_SOURCE_KEYS.MENTION_DELEGATION,
    ]);
    expect(
      (await messageModel.queryInjectionMessagesByTopic(topicId)).map((row) => row.sourceKey),
    ).toEqual([INJECTION_SOURCE_KEYS.MENTION_DELEGATION]);
    expect(result.failed.map((entry) => entry.sourceKey)).toEqual([
      INJECTION_SOURCE_KEYS.CONTEXT_SELECTIONS,
    ]);
  });
});
