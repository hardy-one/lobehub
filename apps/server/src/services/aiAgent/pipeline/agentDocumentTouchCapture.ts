import { LOADING_FLAT } from '@lobechat/const';
import { INJECTION_SOURCE_KEYS } from '@lobechat/types';
import debug from 'debug';

import type { MessageModel } from '@/database/models/message';

const log = debug('lobe-server:ai-agent-service');

export type AgentDocumentTouchKind = 'created' | 'edited' | 'deleted';

export interface AgentDocumentTouchInput {
  agentDocumentId?: string;
  anchorCreatedAt?: number;
  /** The turn's client id, used by the lambda router chain. */
  clientMessageId?: string;
  kind: AgentDocumentTouchKind;
  /** Source-message DB primary key. The runtime chain passes this. */
  messageId?: string;
  messageModel: MessageModel;
  title?: string;
  topicId?: string;
}

interface TouchTiming {
  anchorCreatedAt: number;
  assistantCreatedAt?: number;
}

const changeLabel: Record<AgentDocumentTouchKind, string> = {
  created: 'created',
  deleted: 'deleted',
  edited: 'edited',
};

const findAssistantPlaceholder = async (messageModel: MessageModel, anchorId: string) => {
  const anchor = await messageModel.findById(anchorId);
  if (!anchor?.topicId) return undefined;
  const candidates = await messageModel.query({
    skipCompressedMembers: true,
    threadId: anchor.threadId,
    topicId: anchor.topicId,
  });
  return candidates
    .filter(
      (message) =>
        !message.isInjection &&
        message.role === 'assistant' &&
        message.parentId === anchorId &&
        message.content === LOADING_FLAT,
    )
    .sort(
      (first, second) => first.createdAt - second.createdAt || first.id.localeCompare(second.id),
    )[0];
};

const resolveTouchTiming = async (
  messageModel: MessageModel,
  topicId: string,
  anchorId: string | undefined,
  anchorCreatedAt: number,
): Promise<TouchTiming> => {
  const assistant = anchorId ? await findAssistantPlaceholder(messageModel, anchorId) : undefined;
  if (!assistant) {
    log(
      'captureAgentDocumentTouch: assistant placeholder unavailable for anchor=%s topic=%s; using user.createdAt + offsets capped at 9ms',
      anchorId,
      topicId,
    );
    return { anchorCreatedAt, assistantCreatedAt: anchorCreatedAt + 10 };
  }
  return {
    anchorCreatedAt,
    assistantCreatedAt: assistant.createdAt,
  };
};

/**
 * One line = one tool touch. Keeps the same columns as
 * `formatAgentDocumentChanges` so the replayed row speaks the index's
 * language, but stores no document body: full text stays in the tool result.
 * The anchor timestamp is the only time value, so the same event always
 * renders the same bytes.
 */
export const formatAgentDocumentTouch = (input: {
  agentDocumentId?: string;
  kind: AgentDocumentTouchKind;
  title?: string;
}): string => {
  const id = input.agentDocumentId ?? '—';
  const title = input.title?.trim() || '(untitled)';
  const width = (header: string, value: string) => Math.max(header.length, value.length);
  const changeWidth = width('CHANGE', changeLabel[input.kind]);
  const titleWidth = width('TITLE', title);
  const idWidth = width('ID', id);
  const line = (change: string, name: string, documentId: string) =>
    [change.padEnd(changeWidth), name.padEnd(titleWidth), documentId.padEnd(idWidth)].join('  ');

  return [
    'Agent documents touched by a tool in this conversation. Their content is in the tool result, not this row.',
    '',
    line('CHANGE', 'TITLE', 'ID'),
    line(changeLabel[input.kind], title, id),
  ].join('\n');
};

/**
 * Persist a document-tool touch as an injection row on the conversation that
 * issued the tool call. Background calls without a topicId are skipped, and
 * a failed write never fails the document operation itself.
 */
export const captureAgentDocumentTouch = async ({
  agentDocumentId,
  anchorCreatedAt,
  clientMessageId,
  kind,
  messageId,
  messageModel,
  title,
  topicId,
}: AgentDocumentTouchInput) => {
  if (!topicId) return;

  let anchorId: string | undefined;
  let anchorThreadId: string | null | undefined;
  let userMessageCreatedAt = anchorCreatedAt;
  if (userMessageCreatedAt === undefined && clientMessageId) {
    const userMessage = await messageModel.findByClientId(clientMessageId);
    anchorId = userMessage?.id;
    anchorThreadId = userMessage?.threadId;
    userMessageCreatedAt = userMessage?.createdAt.getTime();
  }
  if (messageId) {
    const userMessage = await messageModel.findById(messageId);
    anchorId = userMessage?.id;
    anchorThreadId = userMessage?.threadId;
    userMessageCreatedAt = userMessage?.createdAt.getTime();
  }

  let timing: TouchTiming | undefined;
  if (userMessageCreatedAt !== undefined && anchorId) {
    const previous = await messageModel.queryInjectionMessagesByTopicAndThread(
      topicId,
      anchorThreadId,
    );
    const offsets = previous
      .filter(
        (row) =>
          row.threadId === anchorThreadId &&
          row.sourceKey === INJECTION_SOURCE_KEYS.AGENT_DOC_MESSAGE &&
          row.createdAt >= userMessageCreatedAt,
      )
      .map((row) => row.createdAt - userMessageCreatedAt)
      .sort((first, second) => first - second);
    let nextOffset = 1;
    for (const offset of offsets) {
      if (offset < nextOffset) continue;
      if (offset > nextOffset) break;
      nextOffset += 1;
    }
    timing = await resolveTouchTiming(messageModel, topicId, anchorId, userMessageCreatedAt);
    if (timing.assistantCreatedAt !== undefined) {
      const maxCreatedAt = Math.min(timing.assistantCreatedAt, userMessageCreatedAt + 10) - 1;
      timing.anchorCreatedAt = Math.max(
        userMessageCreatedAt,
        Math.min(timing.anchorCreatedAt + nextOffset, maxCreatedAt),
      );
    }
  }

  if (!timing) {
    log(
      'captureAgentDocumentTouch: no message row for messageId=%s clientMessageId=%s topic=%s; falling back to Date.now()',
      messageId,
      clientMessageId,
      topicId,
    );
    timing = { anchorCreatedAt: Date.now() };
  }

  return messageModel.appendInjectionRow(
    topicId,
    INJECTION_SOURCE_KEYS.AGENT_DOC_MESSAGE,
    formatAgentDocumentTouch({ agentDocumentId, kind, title }),
    'user',
    {
      anchorMessageId: anchorId,
      createdAt: timing.anchorCreatedAt,
      threadId: anchorThreadId,
    },
  );
};

/** Tool-route adapter: swallows storage errors so a document write is never rolled back. */
export const captureAgentDocumentTouchSafely = async (input: AgentDocumentTouchInput) => {
  if (!input.topicId) return;

  try {
    await captureAgentDocumentTouch(input);
  } catch (error) {
    log('captureAgentDocumentTouchSafely: failed to persist touch row: %O', error);
  }
};
