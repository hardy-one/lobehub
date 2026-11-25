import {
  type AgentDocumentChange,
  formatAgentDocumentChanges,
} from '@lobechat/context-engine/agent-document';
import { INJECTION_SOURCE_KEYS } from '@lobechat/types';
import debug from 'debug';

import type { MessageModel } from '@/database/models/message';

const log = debug('lobe-server:ai-agent-service');

export interface AgentDocumentChangesCaptureInput {
  agentDocumentChanges?: Record<string, AgentDocumentChange[]>;
  messageModel: Pick<MessageModel, 'appendInjectionRow' | 'findById'>;
  topicId?: string;
  userMessageId?: string;
}

export const captureAgentDocumentChanges = async ({
  agentDocumentChanges,
  messageModel,
  topicId,
  userMessageId,
}: AgentDocumentChangesCaptureInput) => {
  if (!topicId || !userMessageId) return;

  const anchor = await messageModel.findById(userMessageId);
  if (!anchor || anchor.isInjection || anchor.role !== 'user' || anchor.topicId !== topicId) return;

  const changes = agentDocumentChanges?.[userMessageId];
  if (!changes?.length) return;

  await messageModel.appendInjectionRow(
    topicId,
    INJECTION_SOURCE_KEYS.AGENT_DOC_CHANGES,
    formatAgentDocumentChanges(changes),
    'user',
    {
      anchorMessageId: anchor.id,
      createdAt: anchor.createdAt.getTime(),
      threadId: anchor.threadId,
    },
  );
};

export const captureAgentDocumentChangesSafely = async (
  input: AgentDocumentChangesCaptureInput,
) => {
  if (!input.topicId || !input.userMessageId) return;

  try {
    await captureAgentDocumentChanges(input);
  } catch (error) {
    log('captureAgentDocumentChangesSafely: failed to persist document changes: %O', error);
  }
};
