// @vitest-environment node
import { MessageGroupType } from '@lobechat/types';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Real prune helper used by AiAgentService.execAgent in server-runtime regenerate.
import { pruneRegeneratedBranch } from '../../../../../../apps/server/src/services/aiAgent/pruneRegeneratedBranch';
import { getTestDB } from '../../../core/getTestDB';
import { messageGroups, messages, threads, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';

const userId = 'regenerate-prune-test-user';
const topicId = 'regenerate-prune-topic';

let messageModel: MessageModel;
let serverDB: LobeChatDatabase;

beforeEach(async () => {
  serverDB = await getTestDB();

  await serverDB.delete(messageGroups);
  await serverDB.delete(messages);
  await serverDB.delete(topics);
  await serverDB.delete(users);

  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(topics).values({ id: topicId, userId });

  messageModel = new MessageModel(serverDB, userId);
});

afterEach(async () => {
  await serverDB.delete(users);
});

/**
 * End-to-end (real DB) verification of the server-runtime regenerate prune chain:
 * real MessageModel.query + real MessageModel.queryTopicMessageTree + the real
 * pruneRegeneratedBranch helper that execAgent uses. No mocks, no LLM.
 *
 * Tree: prior-u → prior-a → u1(anchor) → a1(old answer) → u2 → a2
 */
describe('server-runtime regenerate branch prune (real DB)', () => {
  const seedConversation = async () => {
    await serverDB.insert(messages).values([
      {
        id: 'prior-u',
        content: 'prior q',
        role: 'user',
        topicId,
        userId,
        createdAt: new Date('2024-01-01T10:00:00Z'),
      },
      {
        id: 'prior-a',
        content: 'prior a',
        role: 'assistant',
        parentId: 'prior-u',
        topicId,
        userId,
        createdAt: new Date('2024-01-01T10:01:00Z'),
      },
      {
        id: 'u1',
        content: 'the question',
        role: 'user',
        parentId: 'prior-a',
        topicId,
        userId,
        createdAt: new Date('2024-01-01T10:02:00Z'),
      },
      {
        id: 'a1',
        content: 'OLD answer',
        role: 'assistant',
        parentId: 'u1',
        topicId,
        userId,
        createdAt: new Date('2024-01-01T10:03:00Z'),
      },
      {
        id: 'u2',
        content: 'follow-up q',
        role: 'user',
        parentId: 'a1',
        topicId,
        userId,
        createdAt: new Date('2024-01-01T10:04:00Z'),
      },
      {
        id: 'a2',
        content: 'follow-up a',
        role: 'assistant',
        parentId: 'u2',
        topicId,
        userId,
        createdAt: new Date('2024-01-01T10:05:00Z'),
      },
    ]);
  };

  it('drops the uncompacted old branch (a1 + later turns) so history ends at the anchor', async () => {
    await seedConversation();

    const history = await messageModel.query({ topicId });
    const tree = await messageModel.queryTopicMessageTree({ topicId });

    const pruned = pruneRegeneratedBranch(history, tree, 'u1');

    expect(pruned.map((m) => m.id)).toEqual(['prior-u', 'prior-a', 'u1']);
  });

  it('drops a compressedGroup whose compacted members descend from the anchor (regression: /compact)', async () => {
    await seedConversation();

    // Compact the old branch [a1, u2, a2] into a compression group.
    await serverDB.insert(messageGroups).values({
      id: 'grp-old-branch',
      content: 'summary of old branch',
      type: MessageGroupType.Compression,
      topicId,
      userId,
      createdAt: new Date('2024-01-01T10:06:00Z'),
    });
    await serverDB
      .update(messages)
      .set({ messageGroupId: 'grp-old-branch' })
      .where(inArray(messages.id, ['a1', 'u2', 'a2']));

    const history = await messageModel.query({ topicId });
    const tree = await messageModel.queryTopicMessageTree({ topicId });

    // Premise: query hides the grouped messages and injects a synthetic
    // compressedGroup node that carries NO parentId.
    const groupNode = history.find((m) => m.role === 'compressedGroup') as any;
    expect(groupNode).toBeDefined();
    expect(groupNode.id).toBe('grp-old-branch');
    expect(groupNode.parentId ?? null).toBeNull();
    expect(history.map((m) => m.id)).toEqual(['prior-u', 'prior-a', 'u1', 'grp-old-branch']);

    // queryTopicMessageTree still exposes the hidden members with their parentIds.
    const treeIds = tree.map((r) => r.id).sort();
    expect(treeIds).toEqual(['a1', 'a2', 'prior-a', 'prior-u', 'u1', 'u2']);
    const a1Row = tree.find((r) => r.id === 'a1')!;
    expect(a1Row.parentId).toBe('u1');
    expect(a1Row.messageGroupId).toBe('grp-old-branch');

    // The fix: the compressedGroup summarizing the old branch is pruned.
    const pruned = pruneRegeneratedBranch(history, tree, 'u1');
    expect(pruned.map((m) => m.id)).toEqual(['prior-u', 'prior-a', 'u1']);
  });

  it('keeps a compressedGroup whose members precede the anchor (legitimate earlier context)', async () => {
    await seedConversation();

    // Compact the PRIOR turn [prior-u, prior-a] — this is context before the anchor.
    await serverDB.insert(messageGroups).values({
      id: 'grp-prior',
      content: 'summary of prior turns',
      type: MessageGroupType.Compression,
      topicId,
      userId,
      createdAt: new Date('2024-01-01T10:01:30Z'),
    });
    await serverDB
      .update(messages)
      .set({ messageGroupId: 'grp-prior' })
      .where(inArray(messages.id, ['prior-u', 'prior-a']));

    const history = await messageModel.query({ topicId });
    const tree = await messageModel.queryTopicMessageTree({ topicId });

    const pruned = pruneRegeneratedBranch(history, tree, 'u1');

    // Prior-turn group kept; the anchor's own old branch (a1, u2, a2) dropped.
    expect(pruned.map((m) => m.id)).toEqual(['grp-prior', 'u1']);
  });

  it('keeps anchor injections but removes the old answer and descendant injections', async () => {
    await seedConversation();
    const anchorMention = await messageModel.appendInjectionRow(
      topicId,
      'mention_delegation',
      'anchor mention context',
      'user',
      { anchorMessageId: 'u1', createdAt: new Date('2024-01-01T10:02:01Z') },
    );
    const anchorTool = await messageModel.appendInjectionRow(
      topicId,
      'selected_tool',
      'anchor tool context',
      'user',
      { anchorMessageId: 'u1', createdAt: new Date('2024-01-01T10:02:02Z') },
    );
    const answerTouch = await messageModel.appendInjectionRow(
      topicId,
      'agent_doc_message',
      'old answer document touch',
      'user',
      { createdAt: new Date('2024-01-01T10:03:01Z'), threadId: null },
    );
    await serverDB.update(messages).set({ parentId: 'a1' }).where(eq(messages.id, answerTouch.id));
    const followUpSkill = await messageModel.appendInjectionRow(
      topicId,
      'selected_skill',
      'old follow-up skill context',
      'user',
      { anchorMessageId: 'u2', createdAt: new Date('2024-01-01T10:04:01Z') },
    );
    const legacy = await messageModel.appendInjectionRow(
      topicId,
      'mention_delegation',
      'legacy unanchored context',
      'user',
      { createdAt: new Date('2024-01-01T10:03:02Z') },
    );

    const history = await messageModel.queryForModelInput({ topicId });
    const tree = await messageModel.queryTopicMessageTree({ topicId });
    const pruned = pruneRegeneratedBranch(history, tree, 'u1');

    expect(pruned.map((message) => message.id)).toEqual([
      'prior-u',
      'prior-a',
      'u1',
      anchorMention.id,
      anchorTool.id,
      legacy.id,
    ]);
    expect(pruned.map((message) => message.id)).not.toContain(answerTouch.id);
    expect(pruned.map((message) => message.id)).not.toContain(followUpSkill.id);
  });

  it('keeps anchor injections while pruning a compacted old branch', async () => {
    await seedConversation();
    const anchorTouch = await messageModel.appendInjectionRow(
      topicId,
      'agent_doc_message',
      'anchor document touch',
      'user',
      { anchorMessageId: 'u1', createdAt: new Date('2024-01-01T10:02:01Z') },
    );
    const answerTouch = await messageModel.appendInjectionRow(
      topicId,
      'agent_doc_message',
      'compacted old answer document touch',
      'user',
      { createdAt: new Date('2024-01-01T10:03:01Z'), threadId: null },
    );
    await serverDB.update(messages).set({ parentId: 'a1' }).where(eq(messages.id, answerTouch.id));
    await serverDB.insert(messageGroups).values({
      content: 'summary of old branch',
      createdAt: new Date('2024-01-01T10:06:00Z'),
      id: 'grp-old-branch',
      topicId,
      type: MessageGroupType.Compression,
      userId,
    });
    await serverDB
      .update(messages)
      .set({ messageGroupId: 'grp-old-branch' })
      .where(inArray(messages.id, ['a1', 'u2', 'a2']));

    const history = await messageModel.queryForModelInput({ topicId });
    const tree = await messageModel.queryTopicMessageTree({ topicId });
    const pruned = pruneRegeneratedBranch(history, tree, 'u1');

    expect(pruned.map((message) => message.id)).toEqual([
      'prior-u',
      'prior-a',
      'u1',
      anchorTouch.id,
    ]);
  });

  it('keeps thread anchor injections and prunes only the old thread descendants', async () => {
    await serverDB.insert(threads).values({
      id: 'regen-thread',
      topicId,
      type: 'continuation',
      userId,
    });
    const threadUser = await messageModel.create({
      content: 'thread question',
      createdAt: new Date('2024-01-01T10:02:00Z'),
      role: 'user',
      threadId: 'regen-thread',
      topicId,
    });
    expect(threadUser.role).toBe('user');
    const anchorTouch = await messageModel.appendInjectionRow(
      topicId,
      'agent_doc_message',
      'thread anchor touch',
      'user',
      {
        anchorMessageId: threadUser.id,
        createdAt: new Date('2024-01-01T10:02:01Z'),
      },
    );
    const oldAnswer = await messageModel.create({
      content: 'old thread answer',
      createdAt: new Date('2024-01-01T10:03:00Z'),
      id: 'thread-a1',
      parentId: threadUser.id,
      role: 'assistant',
      threadId: 'regen-thread',
      topicId,
    });
    const answerTouch = await messageModel.appendInjectionRow(
      topicId,
      'agent_doc_message',
      'old thread answer touch',
      'user',
      { createdAt: new Date('2024-01-01T10:03:01Z'), threadId: 'regen-thread' },
    );

    expect(anchorTouch.threadId).toBe('regen-thread');
    await serverDB
      .update(messages)
      .set({ parentId: oldAnswer.id })
      .where(eq(messages.id, answerTouch.id));
    expect(answerTouch.threadId).toBe('regen-thread');
    const history = await messageModel.queryForModelInput({
      threadId: 'regen-thread',
      topicId,
    });
    const tree = await messageModel.queryTopicMessageTree({
      threadId: 'regen-thread',
      topicId,
    });

    expect(tree.map((row) => row.id)).toEqual(
      expect.arrayContaining([threadUser.id, anchorTouch.id, oldAnswer.id, answerTouch.id]),
    );
    expect(pruneRegeneratedBranch(history, tree, threadUser.id).map((row) => row.id)).toEqual([
      threadUser.id,
      anchorTouch.id,
    ]);
  });
});
