// @vitest-environment node
import { INJECTION_SOURCE_KEYS } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { messages, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'message-delete-injection-user';
const messageModel = new MessageModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.insert(users).values({ id: userId });
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
});

describe('MessageModel deletion of injection children', () => {
  it('unanchors a deleted user turn injection without moving its assistant descendants', async () => {
    await serverDB.insert(messages).values([
      { content: 'earlier question', id: 'earlier-user', role: 'user', userId },
      {
        content: 'deleted question',
        id: 'deleted-user',
        parentId: 'earlier-user',
        role: 'user',
        userId,
      },
      {
        content: 'deleted answer',
        id: 'deleted-answer',
        parentId: 'deleted-user',
        role: 'assistant',
        userId,
      },
      {
        content: 'anchor context',
        id: 'anchor-injection',
        isInjection: true,
        parentId: 'deleted-user',
        role: 'user',
        sourceKey: INJECTION_SOURCE_KEYS.MENTION_DELEGATION,
        userId,
      },
      {
        content: 'answer context',
        id: 'answer-injection',
        isInjection: true,
        parentId: 'deleted-answer',
        role: 'user',
        sourceKey: INJECTION_SOURCE_KEYS.AGENT_DOC_MESSAGE,
        userId,
      },
    ]);

    await messageModel.deleteMessage('deleted-user');

    const remaining = await serverDB
      .select({ id: messages.id, parentId: messages.parentId })
      .from(messages)
      .where(eq(messages.userId, userId));
    expect(remaining).toEqual(
      expect.arrayContaining([
        { id: 'anchor-injection', parentId: null },
        { id: 'deleted-answer', parentId: 'earlier-user' },
        { id: 'answer-injection', parentId: 'deleted-answer' },
      ]),
    );
  });

  it('never reparents injection children onto an assistant or another user in a batch delete', async () => {
    await serverDB.insert(messages).values([
      { content: 'earlier question', id: 'earlier-user', role: 'user', userId },
      {
        content: 'first deleted question',
        id: 'deleted-user-a',
        parentId: 'earlier-user',
        role: 'user',
        userId,
      },
      {
        content: 'deleted assistant',
        id: 'deleted-assistant',
        parentId: 'deleted-user-a',
        role: 'assistant',
        userId,
      },
      {
        content: 'second deleted question',
        id: 'deleted-user-b',
        parentId: 'deleted-assistant',
        role: 'user',
        userId,
      },
      {
        content: 'first anchor context',
        id: 'anchor-injection-a',
        isInjection: true,
        parentId: 'deleted-user-a',
        role: 'user',
        sourceKey: INJECTION_SOURCE_KEYS.MENTION_DELEGATION,
        userId,
      },
      {
        content: 'second anchor context',
        id: 'anchor-injection-b',
        isInjection: true,
        parentId: 'deleted-user-b',
        role: 'user',
        sourceKey: INJECTION_SOURCE_KEYS.SELECTED_TOOL,
        userId,
      },
    ]);

    await messageModel.deleteMessages(['deleted-user-a', 'deleted-assistant', 'deleted-user-b']);

    const remaining = await serverDB
      .select({ id: messages.id, parentId: messages.parentId })
      .from(messages)
      .where(eq(messages.userId, userId));
    expect(remaining).toEqual(
      expect.arrayContaining([
        { id: 'anchor-injection-a', parentId: null },
        { id: 'anchor-injection-b', parentId: null },
        { id: 'earlier-user', parentId: null },
      ]),
    );
  });
});
