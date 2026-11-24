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

const changeLabel: Record<AgentDocumentTouchKind, string> = {
  created: 'created',
  deleted: 'deleted',
  edited: 'edited',
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

  let resolvedAnchor = anchorCreatedAt;
  if (resolvedAnchor === undefined && clientMessageId) {
    const userMessage = await messageModel.findByClientId(clientMessageId);
    resolvedAnchor = userMessage?.createdAt.getTime();
  }
  if (resolvedAnchor === undefined && messageId) {
    const userMessage = await messageModel.findById(messageId);
    resolvedAnchor = userMessage?.createdAt.getTime();
  }

  if (resolvedAnchor !== undefined) {
    const previous = await messageModel.queryInjectionMessagesByTopic(topicId);
    const latest = previous
      .filter((row) => row.sourceKey === INJECTION_SOURCE_KEYS.AGENT_DOC_MESSAGE)
      .reduce((max, row) => Math.max(max, new Date(row.createdAt).getTime()), 0);
    resolvedAnchor = Math.max(resolvedAnchor, latest + 1);
  }

  if (resolvedAnchor === undefined) {
    log(
      'captureAgentDocumentTouch: no message row for messageId=%s clientMessageId=%s topic=%s; falling back to Date.now()',
      messageId,
      clientMessageId,
      topicId,
    );
    resolvedAnchor = Date.now();
  }

  return messageModel.appendInjectionRow(
    topicId,
    INJECTION_SOURCE_KEYS.AGENT_DOC_MESSAGE,
    formatAgentDocumentTouch({ agentDocumentId, kind, title }),
    'user',
    { createdAt: resolvedAnchor },
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
