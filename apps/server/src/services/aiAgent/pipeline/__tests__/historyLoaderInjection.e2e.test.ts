// @vitest-environment node
import {
  formatMentionedAgentsContext,
  formatSelectedSkillsContext,
  formatSelectedToolsContext,
  MessagesEngine,
  type MessagesEngineParams,
} from '@lobechat/context-engine';
import type { LobeChatDatabase } from '@lobechat/database';
import { messages, topics, users } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import type { RuntimeMentionedAgent, UIChatMessage } from '@lobechat/types';
import { INJECTION_SOURCE_KEYS } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageModel } from '@/database/models/message';

import { captureMessageInjections } from '../messageInjectionCapture';
import { createHistoryMessagesLoader } from '../operationPrep';

vi.mock('@/server/services/file', () => ({
  FileService: class {
    getFileAccessUrl = vi.fn();
  },
}));

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'history-loader-injection-user';
const topicId = 'history-loader-injection-topic';
const baseTime = Date.UTC(2026, 4, 3, 0, 0);

const mentionedAgents: RuntimeMentionedAgent[] = [{ id: 'agt_delegate', name: 'Delegate' }];
const selectedSkills = [
  {
    content: 'UX AUDIT BODY',
    description: 'Audit a screen',
    identifier: 'ux-audit',
    name: 'UX Audit',
  },
];
const selectedTools = [{ content: 'BROWSE BODY', identifier: 'web-browse', name: 'Web Browse' }];

const skillSet = {
  enabledPluginIds: ['ux-audit'],
  skills: selectedSkills,
};

const toolManifestMap = {
  'web-browse': {
    api: [],
    identifier: 'web-browse',
    meta: { title: 'Web Browse' },
    systemRole: 'BROWSE BODY',
  },
};

const messageModel = new MessageModel(serverDB, userId);

const engineParams = (
  messages: UIChatMessage[],
  extra: Partial<MessagesEngineParams> = {},
): MessagesEngineParams => ({
  enableSystemDate: false,
  messages,
  model: 'gpt-4',
  provider: 'openai',
  systemRole: 'You are a helpful assistant.',
  ...extra,
});

const occurrences = (serialized: string, marker: string) =>
  serialized.match(new RegExp(marker, 'g'))?.length ?? 0;

const loadHistory = async (selfMessageIds: string[]) => {
  const loader = createHistoryMessagesLoader(
    {
      db: serverDB,
      isShareVisitorRun: false,
      messageModel,
      userId,
    },
    {
      appContext: { topicId },
      effectiveResume: false,
      existingMessageIds: [],
      resumeParentMessage: undefined,
      selfMessageIds: new Set(selfMessageIds),
    },
  );

  return loader();
};

beforeEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(topics).values({ id: topicId, userId });
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
});

describe('history loader consumes persisted injection rows', () => {
  it('replays a turn context in place and keeps it across the next operation', async () => {
    const user = await messageModel.create({
      content: 'Ask @Delegate to audit this screen with @web-browse',
      createdAt: baseTime,
      role: 'user',
      topicId,
    });

    // Real write path: the same hook production uses after operation prep.
    const { written } = await captureMessageInjections({
      anchorMessageId: user.id,
      // Production passes the persisted user row's timestamp; the merge must
      // keep the injected rows after the message they belong to.
      anchorCreatedAt: user.createdAt.getTime(),
      mentionedAgents,
      messageModel,
      selectedSkillIds: ['ux-audit'],
      selectedToolIds: ['web-browse'],
      skillSet,
      toolManifestMap,
      topicId,
    });

    const answer = await messageModel.create({
      content: 'Delegated answer',
      createdAt: baseTime + 10,
      parentId: user.id,
      role: 'assistant',
      topicId,
    });

    // Same operation, next step: the model-input read must carry the rows and
    // the engine must not emit the legacy blocks a second time.
    const stepTimeline = await messageModel.queryForModelInput({ topicId });
    expect(stepTimeline.map((row) => row.id)).toEqual([
      user.id,
      ...written.map((row) => row.id),
      answer.id,
    ]);

    const current = await new MessagesEngine(
      engineParams(stepTimeline, {
        agentManagementContext: { mentionedAgents },
        selectedSkills,
        selectedTools,
      }),
    ).process();
    const currentContents = current.messages
      .map((message) => (typeof message.content === 'string' ? message.content : ''))
      .join('\n');
    expect(currentContents).toContain(formatMentionedAgentsContext(mentionedAgents));
    expect(currentContents).toContain(formatSelectedSkillsContext(selectedSkills));
    expect(currentContents).toContain(formatSelectedToolsContext(selectedTools));
    const currentSerialized = JSON.stringify(current.messages);
    expect(occurrences(currentSerialized, '<mentioned_agents>')).toBe(1);
    expect(occurrences(currentSerialized, '<selected_skills>')).toBe(1);
    expect(occurrences(currentSerialized, '<selected_tools>')).toBe(1);

    // Next operation: no live mention/selection inputs at all. The production
    // history loader still has to bring the persisted rows back.
    const nextUser = await messageModel.create({
      content: 'Thanks, continue',
      createdAt: baseTime + 100,
      role: 'user',
      topicId,
    });
    const nextAnswer = await messageModel.create({
      content: 'Continuing',
      createdAt: baseTime + 110,
      parentId: nextUser.id,
      role: 'assistant',
      topicId,
    });

    const history = await loadHistory([nextUser.id, nextAnswer.id]);
    expect(history.map((row) => row.id)).toEqual([
      user.id,
      ...written.map((row) => row.id),
      answer.id,
    ]);

    expect(history.filter((row) => row.isInjection).map((row) => row.sourceKey)).toEqual([
      INJECTION_SOURCE_KEYS.MENTION_DELEGATION,
      INJECTION_SOURCE_KEYS.SELECTED_SKILL,
      INJECTION_SOURCE_KEYS.SELECTED_TOOL,
    ]);

    // Operation prep appends the in-memory current prompt after history.
    const nextTimeline = [
      ...history,
      {
        content: nextUser.content ?? '',
        createdAt: baseTime + 100,
        id: nextUser.id,
        role: 'user',
      },
    ] as UIChatMessage[];
    const next = await new MessagesEngine(engineParams(nextTimeline)).process();
    const nextSerialized = JSON.stringify(next.messages);
    expect(occurrences(nextSerialized, '<mentioned_agents>')).toBe(1);
    expect(occurrences(nextSerialized, '<selected_skills>')).toBe(1);
    expect(occurrences(nextSerialized, '<selected_tools>')).toBe(1);

    const indexOf = (marker: string) =>
      next.messages.findIndex((message) =>
        typeof message.content === 'string' ? message.content.includes(marker) : false,
      );
    expect(indexOf('<mentioned_agents>')).toBeGreaterThan(
      next.messages.findIndex((message) => message.content === user.content),
    );
    expect(indexOf('<mentioned_agents>')).toBeLessThan(indexOf('<selected_skills>'));
    expect(indexOf('<selected_skills>')).toBeLessThan(indexOf('<selected_tools>'));
    expect(indexOf('<selected_tools>')).toBeLessThan(
      next.messages.findIndex((message) => message.content === answer.content),
    );
  });

  it('leaves a topic without injected rows byte-identical', async () => {
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

    const legacy = await messageModel.query({ topicId });
    const modelInput = await messageModel.queryForModelInput({ topicId });
    expect(JSON.stringify(modelInput)).toBe(JSON.stringify(legacy));

    // No turn rows to exclude: the point is that the read itself is unchanged
    // when the topic has no injected rows.
    const history = await loadHistory([]);
    expect(JSON.stringify(history)).toBe(JSON.stringify(legacy));
  });

  it('prunes the regenerated branch through operationPrep while keeping anchor injections', async () => {
    const prior = await messageModel.create({
      content: 'prior question',
      createdAt: baseTime,
      role: 'user',
      topicId,
    });
    const anchor = await messageModel.create({
      content: 'regenerate this',
      createdAt: baseTime + 60_000,
      parentId: prior.id,
      role: 'user',
      topicId,
    });
    const anchorInjection = await messageModel.appendInjectionRow(
      topicId,
      INJECTION_SOURCE_KEYS.AGENT_DOC_MESSAGE,
      'anchor touch',
      'user',
      { anchorMessageId: anchor.id, createdAt: baseTime + 60_001 },
    );
    const oldAnswer = await messageModel.create({
      content: 'old answer',
      createdAt: baseTime + 120_000,
      parentId: anchor.id,
      role: 'assistant',
      topicId,
    });
    const answerInjection = await messageModel.appendInjectionRow(
      topicId,
      INJECTION_SOURCE_KEYS.AGENT_DOC_MESSAGE,
      'old answer touch',
      'user',
      { createdAt: baseTime + 120_001 },
    );
    await serverDB
      .update(messages)
      .set({ parentId: oldAnswer.id })
      .where(eq(messages.id, answerInjection.id));
    const loader = createHistoryMessagesLoader(
      { db: serverDB, isShareVisitorRun: false, messageModel, userId },
      {
        appContext: { topicId },
        effectiveResume: true,
        existingMessageIds: [],
        parentMessageId: anchor.id,
        resumeParentMessage: anchor,
        selfMessageIds: new Set(),
      },
    );

    const history = await loader();

    expect(history.map((row) => row.id)).toEqual([prior.id, anchor.id, anchorInjection.id]);
    expect(history.map((row) => row.id)).not.toContain(answerInjection.id);
    console.log(
      '[operationPrep regenerate]',
      history.map((row) => ({ id: row.id, parentId: row.parentId, source: row.sourceKey })),
    );
  });
});
