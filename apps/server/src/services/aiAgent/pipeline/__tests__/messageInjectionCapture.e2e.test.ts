// @vitest-environment node
import {
  formatMentionedAgentsContext,
  formatSelectedSkills,
  formatSelectedSkillsContext,
  formatSelectedTools,
  formatSelectedToolsContext,
  MessagesEngine,
  type MessagesEngineParams,
} from '@lobechat/context-engine';
import type { LobeChatDatabase } from '@lobechat/database';
import { topics, users } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import type { RuntimeMentionedAgent, UIChatMessage } from '@lobechat/types';
import { INJECTION_SOURCE_KEYS } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MessageModel } from '@/database/models/message';

import { buildMessageInjectionRows, captureMessageInjections } from '../messageInjectionCapture';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'message-injection-capture-user';
const topicId = 'message-injection-capture-topic';

const baseTime = Date.UTC(2026, 4, 2, 0, 0);

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

const mergeTimeline = (real: UIChatMessage[], injected: UIChatMessage[]): UIChatMessage[] =>
  [...real, ...injected].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));

const engineParams = (
  timeline: UIChatMessage[],
  extra: Partial<MessagesEngineParams> = {},
): MessagesEngineParams => ({
  enableSystemDate: false,
  messages: timeline,
  model: 'gpt-4',
  provider: 'openai',
  systemRole: 'You are a helpful assistant.',
  ...extra,
});

const occurrences = (serialized: string, marker: string) =>
  serialized.match(new RegExp(marker, 'g'))?.length ?? 0;

beforeEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(topics).values({ id: topicId, userId });
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
});

describe('append-only v2 message ingestion (mention / skill / tool)', () => {
  it('renders the same blocks as the legacy injectors', () => {
    const rows = buildMessageInjectionRows({
      mentionedAgents,
      selectedSkillIds: ['ux-audit'],
      selectedToolIds: ['web-browse'],
      skillSet,
      toolManifestMap,
    });

    expect(rows).toEqual([
      {
        content: formatMentionedAgentsContext(mentionedAgents),
        sourceKey: INJECTION_SOURCE_KEYS.MENTION_DELEGATION,
      },
      {
        content: formatSelectedSkillsContext(selectedSkills),
        sourceKey: INJECTION_SOURCE_KEYS.SELECTED_SKILL,
      },
      {
        content: formatSelectedToolsContext(selectedTools),
        sourceKey: INJECTION_SOURCE_KEYS.SELECTED_TOOL,
      },
    ]);
  });

  it('persists anchored rows, replays them in place, and never double-injects', async () => {
    const user = await messageModel.create({
      content: 'Ask @Delegate to audit this screen with @web-browse',
      createdAt: baseTime,
      role: 'user',
      topicId,
    });

    const written = await captureMessageInjections({
      anchorCreatedAt: user.createdAt.getTime() + 1,
      mentionedAgents,
      messageModel,
      selectedSkillIds: ['ux-audit'],
      selectedToolIds: ['web-browse'],
      skillSet,
      toolManifestMap,
      topicId,
    });

    expect(written.map((row) => row.sourceKey)).toEqual([
      INJECTION_SOURCE_KEYS.MENTION_DELEGATION,
      INJECTION_SOURCE_KEYS.SELECTED_SKILL,
      INJECTION_SOURCE_KEYS.SELECTED_TOOL,
    ]);
    expect(written.map((row) => row.createdAt.getTime())).toEqual([
      baseTime + 1,
      baseTime + 2,
      baseTime + 3,
    ]);

    await messageModel.create({
      content: 'Delegated answer',
      createdAt: baseTime + 10,
      parentId: user.id,
      role: 'assistant',
      topicId,
    });

    const real = await messageModel.query({ topicId });
    const injected = await messageModel.queryInjectionMessagesByTopic(topicId);
    expect(injected.map((row) => row.sourceKey)).toEqual([
      INJECTION_SOURCE_KEYS.MENTION_DELEGATION,
      INJECTION_SOURCE_KEYS.SELECTED_SKILL,
      INJECTION_SOURCE_KEYS.SELECTED_TOOL,
    ]);

    const timeline = mergeTimeline(real, injected);
    expect(timeline.map((row) => row.id)).toEqual([
      user.id,
      ...written.map((row) => row.id),
      real[1].id,
    ]);

    // Same operation: the request still carries the live mention/selection
    // inputs, but the persisted rows are already in the timeline. The legacy
    // injectors must stay silent for each registered source.
    const current = await new MessagesEngine(
      engineParams(timeline, {
        agentManagementContext: { mentionedAgents },
        selectedSkills,
        selectedTools,
      }),
    ).process();
    const currentSerialized = JSON.stringify(current.messages);
    expect(occurrences(currentSerialized, '<mentioned_agents>')).toBe(1);
    expect(occurrences(currentSerialized, '<selected_skills>')).toBe(1);
    expect(occurrences(currentSerialized, '<selected_tools>')).toBe(1);

    // Next operation: no mention/selection inputs at all. The rows still
    // replay at their original timeline positions, so the delegation and
    // selection context no longer evaporates between operations.
    const next = await new MessagesEngine(engineParams(timeline)).process();
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
      next.messages.findIndex((message) => message.content === 'Delegated answer'),
    );

    // Replay is a read: the persisted timeline is unchanged.
    const afterReplay = await messageModel.queryInjectionMessagesByTopic(topicId);
    expect(afterReplay.map((row) => row.id)).toEqual(written.map((row) => row.id));
  });

  it('keeps the legacy injectors producing their blocks when no row exists', async () => {
    const timeline = [
      { content: 'hello', createdAt: baseTime, id: 'u1', role: 'user' },
    ] as UIChatMessage[];

    const result = await new MessagesEngine(
      engineParams(timeline, {
        agentManagementContext: { mentionedAgents },
        selectedSkills,
        selectedTools,
      }),
    ).process();

    const contains = (block: string) =>
      result.messages.some(
        (message) => typeof message.content === 'string' && message.content.includes(block),
      );
    expect(contains(formatMentionedAgentsContext(mentionedAgents))).toBe(true);
    expect(contains(formatSelectedSkills(selectedSkills)!)).toBe(true);
    expect(contains('<selected_skill_context>')).toBe(true);
    // The tool block is inserted into the wrapper the skill injector created,
    // which is the legacy behaviour this slice deliberately leaves untouched.
    expect(contains(formatSelectedTools(selectedTools)!)).toBe(true);
    expect(contains('<selected_tool_context>')).toBe(true);
  });
});
