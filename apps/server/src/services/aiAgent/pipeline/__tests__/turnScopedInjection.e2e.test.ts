// @vitest-environment node
import {
  formatMentionedAgentsContext,
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

import { formatAgentDocumentTouch } from '../agentDocumentTouchCapture';
import {
  captureMessageInjections,
  type CaptureMessageInjectionsResult,
} from '../messageInjectionCapture';
import { createHistoryMessagesLoader } from '../operationPrep';

// The regenerate probe only needs a history loader (no URL resolution), so stub
// FileService the same way the existing historyLoaderInjection e2e does.
vi.mock('@/server/services/file', () => ({
  FileService: class {
    getFileAccessUrl = vi.fn();
  },
}));

/**
 * Batch 0-C2 acceptance matrix (a–h) on a REAL pglite database.
 *
 * Two surfaces are exercised together:
 * - writer: captureMessageInjections (B1/L5/L6) with per-source failure
 *   injection, plus a direct agent_doc_message (L1) row for the doc-touch path;
 * - reader/switch: MessagesEngine decides per CURRENT turn whether a source is
 *   replayed from its persisted row or (re)fired by the legacy injector.
 *
 * Every scenario prints raw marker-occurrence counts so the assertions can be
 * re-verified from the terminal output alone.
 */
const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'turn-scoped-injection-user';
const topicId = 'turn-scoped-injection-topic';
const baseTime = Date.UTC(2026, 5, 1, 0, 0, 0);

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
const skillSet = { enabledPluginIds: ['ux-audit'], skills: selectedSkills };
const toolManifestMap = {
  'web-browse': {
    api: [],
    identifier: 'web-browse',
    meta: { title: 'Web Browse' },
    systemRole: 'BROWSE BODY',
  },
};
const documents = [
  {
    content: 'After-first-user memo',
    filename: 'after.md',
    loadPosition: 'after-first-user' as const,
    loadRules: { rule: 'always' as const },
    policyLoad: 'always' as const,
  },
  {
    content: 'Context-end memo',
    filename: 'end.md',
    loadPosition: 'context-end' as const,
    loadRules: { rule: 'always' as const },
    policyLoad: 'always' as const,
  },
];

const B1 = INJECTION_SOURCE_KEYS.MENTION_DELEGATION;
const L5 = INJECTION_SOURCE_KEYS.SELECTED_SKILL;
const L6 = INJECTION_SOURCE_KEYS.SELECTED_TOOL;
const L1 = INJECTION_SOURCE_KEYS.AGENT_DOC_MESSAGE;

const messageModel = new MessageModel(serverDB, userId);

const engineParams = (
  timeline: UIChatMessage[],
  extra: Partial<MessagesEngineParams> = {},
): MessagesEngineParams => ({
  agentDocuments: documents,
  agentManagementContext: { mentionedAgents },
  enableSystemDate: false,
  messages: timeline,
  model: 'gpt-4',
  provider: 'openai',
  selectedSkills,
  selectedTools,
  systemRole: 'You are a helpful assistant.',
  ...extra,
});

const occurrences = (serialized: string, marker: string) =>
  serialized.match(new RegExp(marker, 'g'))?.length ?? 0;

const runEngine = async (timeline: UIChatMessage[], extra: Partial<MessagesEngineParams> = {}) => {
  const result = await new MessagesEngine(engineParams(timeline, extra)).process();
  return { serialized: JSON.stringify(result.messages), messages: result.messages };
};

const createUser = (content: string, createdAt: number, parentId?: string) =>
  messageModel.create({
    content,
    createdAt,
    parentId,
    role: 'user',
    topicId,
  });

/** Wrap the message model so chosen sources fail at write time (fail-open probe). */
const wrappedModel = (failed: string[]): Pick<MessageModel, 'appendInjectionRow' | 'findById'> => ({
  appendInjectionRow: (topicIdArg, sourceKey, content, role, options) => {
    if (failed.includes(sourceKey)) throw new Error(`forced writer failure: ${sourceKey}`);
    return messageModel.appendInjectionRow(topicIdArg, sourceKey, content, role, options);
  },
  findById: (id) => messageModel.findById(id),
});

/** Write B1/L5/L6 through the real hook and L1 directly, with per-source failures. */
const writeCurrentTurnSources = async (
  anchor: { createdAt: Date; id: string },
  failed: string[] = [],
) => {
  const anchorMs = anchor.createdAt.getTime();
  const capture: CaptureMessageInjectionsResult = await captureMessageInjections({
    anchorMessageId: anchor.id,
    anchorCreatedAt: anchorMs,
    mentionedAgents,
    messageModel: wrappedModel(failed),
    selectedSkillIds: ['ux-audit'],
    selectedToolIds: ['web-browse'],
    skillSet,
    toolManifestMap,
    topicId,
  });
  let l1Written: { sourceKey?: string | null } | undefined;
  if (!failed.includes(L1)) {
    l1Written = await messageModel.appendInjectionRow(
      topicId,
      L1,
      formatAgentDocumentTouch({
        agentDocumentId: 'doc-1',
        kind: 'created',
        title: 'Launch brief',
      }),
      'user',
      { anchorMessageId: anchor.id, createdAt: anchorMs + 1 },
    );
  }
  return { capture, l1Written };
};

const markerCounts = (serialized: string) => ({
  B1_mentioned_agents: occurrences(serialized, '<mentioned_agents>'),
  L5_selected_skills: occurrences(serialized, '<selected_skills>'),
  L6_selected_tools: occurrences(serialized, '<selected_tools>'),
  L1_touch: occurrences(serialized, 'Agent documents touched by a tool'),
  L1_legacy_memo: occurrences(serialized, 'After-first-user memo'),
});

beforeEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(topics).values({ id: topicId, userId });
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
});

describe('Batch 0-C2 turn-scoped switch — acceptance matrix a–h (real pglite)', () => {
  it('a 当前四源有行各1：当前 turn 四源各回放一次，legacy 静默', async () => {
    const user = await createUser('turn a', baseTime);
    const { capture, l1Written } = await writeCurrentTurnSources(user);
    expect(capture.written.map((row) => row.sourceKey)).toEqual([B1, L5, L6]);
    expect(capture.failed).toHaveLength(0);
    expect(l1Written?.sourceKey).toBe(L1);

    const timeline = await messageModel.queryForModelInput({ topicId });
    expect(timeline.filter((row) => row.isInjection)).toHaveLength(4);
    const { serialized } = await runEngine(timeline);
    const counts = markerCounts(serialized);
    console.log('[a marker occurrences]', JSON.stringify(counts));
    expect(counts.B1_mentioned_agents).toBe(1);
    expect(counts.L5_selected_skills).toBe(1);
    expect(counts.L6_selected_tools).toBe(1);
    expect(counts.L1_touch).toBe(1);
    expect(counts.L1_legacy_memo).toBe(0);
  });

  it('b 历史有行+当前需要+writer失败 = 历史1 + 当前legacy1', async () => {
    const history = await createUser('history turn', baseTime);
    await messageModel.appendInjectionRow(
      topicId,
      B1,
      formatMentionedAgentsContext(mentionedAgents),
      'user',
      { anchorMessageId: history.id, createdAt: baseTime + 1 },
    );
    const current = await createUser('current turn needs mention', baseTime + 1000);

    // Writer fails on B1 for the current turn: returns failed[], throws nothing.
    const capture = await captureMessageInjections({
      anchorMessageId: current.id,
      anchorCreatedAt: current.createdAt.getTime(),
      mentionedAgents,
      messageModel: wrappedModel([B1]),
      topicId,
    });
    console.log(
      '[b writer] written=',
      capture.written.length,
      'failed=',
      capture.failed.map((f) => f.sourceKey),
    );
    expect(capture.written).toHaveLength(0);
    expect(capture.failed.map((f) => f.sourceKey)).toEqual([B1]);

    const timeline = await messageModel.queryForModelInput({ topicId });
    const { serialized } = await runEngine(timeline);
    const b1Count = occurrences(serialized, '<mentioned_agents>');
    console.log('[b marker occurrences] B1_mentioned_agents=', b1Count);
    // One historical replay + one legacy re-fire on the current turn.
    expect(b1Count).toBe(2);
  });

  it('c 历史有行当前不需要 = 历史1且开关正确', async () => {
    const history = await createUser('history turn', baseTime);
    await messageModel.appendInjectionRow(
      topicId,
      B1,
      formatMentionedAgentsContext(mentionedAgents),
      'user',
      { anchorMessageId: history.id, createdAt: baseTime + 1 },
    );
    await createUser('current turn without live inputs', baseTime + 1000);

    const timeline = await messageModel.queryForModelInput({ topicId });
    const { serialized } = await runEngine(timeline, {
      agentDocuments: undefined,
      agentManagementContext: undefined,
      selectedSkills: undefined,
      selectedTools: undefined,
    });
    const b1Count = occurrences(serialized, '<mentioned_agents>');
    console.log('[c marker occurrences] B1_mentioned_agents=', b1Count);
    // Historical row still replays; no live need => no legacy fire.
    expect(b1Count).toBe(1);
  });

  it('d 部分失败 = B1回放1 / L5 legacy1 / L6仍尝试成功回放1', async () => {
    const user = await createUser('turn d', baseTime);
    const { capture } = await writeCurrentTurnSources(user, [L5]);
    console.log(
      '[d writer] written=',
      capture.written.map((row) => row.sourceKey),
      'failed=',
      capture.failed.map((f) => f.sourceKey),
    );
    expect(capture.written.map((row) => row.sourceKey)).toEqual([B1, L6]);
    expect(capture.failed.map((f) => f.sourceKey)).toEqual([L5]);

    const timeline = await messageModel.queryForModelInput({ topicId });
    const { serialized } = await runEngine(timeline);
    const counts = markerCounts(serialized);
    console.log('[d marker occurrences]', JSON.stringify(counts));
    expect(counts.B1_mentioned_agents).toBe(1); // replay
    expect(counts.L5_selected_skills).toBe(1); // legacy re-fire (no current row)
    expect(counts.L6_selected_tools).toBe(1); // replay, not blocked by L5 failure
  });

  it('e 全失败四源 legacy 各1且请求成功', async () => {
    const user = await createUser('turn e', baseTime);
    const { capture } = await writeCurrentTurnSources(user, [B1, L5, L6, L1]);
    console.log(
      '[e writer] written=',
      capture.written.length,
      'failed=',
      capture.failed.map((f) => f.sourceKey),
    );
    expect(capture.written).toHaveLength(0);
    expect(capture.failed.map((f) => f.sourceKey)).toEqual([B1, L5, L6]);

    const timeline = await messageModel.query({ topicId });
    expect(timeline.filter((row) => row.isInjection)).toHaveLength(0);
    // The engine still completes the request with every legacy injector fired.
    const { serialized } = await runEngine(timeline);
    const counts = markerCounts(serialized);
    console.log('[e marker occurrences]', JSON.stringify(counts));
    expect(counts.B1_mentioned_agents).toBe(1);
    expect(counts.L5_selected_skills).toBe(1);
    expect(counts.L6_selected_tools).toBe(1);
    expect(counts.L1_legacy_memo).toBe(1);
  });

  it('f runFromHistory 陈旧 live input 不重复（当前 turn = 历史锚点）', async () => {
    const user = await createUser('history/resume anchor', baseTime);
    await messageModel.appendInjectionRow(
      topicId,
      B1,
      formatMentionedAgentsContext(mentionedAgents),
      'user',
      { anchorMessageId: user.id, createdAt: baseTime + 1 },
    );
    const timeline = await messageModel.queryForModelInput({ topicId });
    // No newer user row: the historical row belongs to the current turn, so the
    // stale mentionedAgents live input must NOT re-fire the legacy injector.
    const { serialized } = await runEngine(timeline);
    const b1Count = occurrences(serialized, '<mentioned_agents>');
    console.log('[f marker occurrences] B1_mentioned_agents=', b1Count);
    expect(b1Count).toBe(1);
  });

  it('g regenerate 锚行保留 / 后代行剪除', async () => {
    const prior = await createUser('prior question', baseTime);
    const anchor = await createUser('regenerate this', baseTime + 60_000, prior.id);
    const anchorInjection = await messageModel.appendInjectionRow(
      topicId,
      L1,
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
    const descendantInjection = await messageModel.appendInjectionRow(
      topicId,
      L1,
      'old answer touch',
      'user',
      { createdAt: baseTime + 120_001 },
    );
    await serverDB
      .update(messages)
      .set({ parentId: oldAnswer.id })
      .where(eq(messages.id, descendantInjection.id));

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
    const ids = history.map((row) => row.id);
    console.log(
      '[g history]',
      JSON.stringify(
        history.map((row) => ({ id: row.id, parentId: row.parentId, source: row.sourceKey })),
      ),
    );
    expect(ids).toContain(anchor.id);
    expect(ids).toContain(anchorInjection.id);
    expect(ids).not.toContain(oldAnswer.id);
    expect(ids).not.toContain(descendantInjection.id);
  });

  it('h topicless 不写库且 legacy 各1', async () => {
    // A topicless turn has no topicId: captureAgentDocumentTouch returns early
    // and captureMessageInjections is never called, so no injection row exists.
    const injected = await messageModel.queryInjectionMessagesByTopic(topicId);
    expect(injected).toHaveLength(0);

    const user = {
      content: 'topicless ask',
      createdAt: baseTime,
      id: 'topicless-user',
      role: 'user',
    } as UIChatMessage;
    const { serialized } = await runEngine([user]);
    const counts = markerCounts(serialized);
    console.log('[h marker occurrences]', JSON.stringify(counts));
    expect(counts.B1_mentioned_agents).toBe(1);
    expect(counts.L5_selected_skills).toBe(1);
    expect(counts.L6_selected_tools).toBe(1);
    expect(counts.L1_legacy_memo).toBe(1);
  });
});
