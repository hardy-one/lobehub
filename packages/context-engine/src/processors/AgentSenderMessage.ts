import type { AgentSenderMetadata } from '@lobechat/types';
import debug from 'debug';
import { Md5 } from 'ts-md5';

import { BaseProcessor } from '../base/BaseProcessor';
import type { InjectionSnapshotStore } from '../injection/InjectionSnapshotStore';
import {
  messageWrapperKey,
  wrapperBlockId,
  type WrapperSnapshot,
} from '../injection/MessageWrapperSnapshots';
import type { PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    agentSenderMessagesProcessed?: number;
    /** T-198 G1: deterministic wrapper identity, recorded pre-cleanup for P2. */
    agentSenderWrapperIds?: Array<{ fingerprint: string; id: string; messageId: string }>;
  }
}

const log = debug('context-engine:processor:AgentSenderMessageProcessor');

/**
 * Tools that can run the `lh` CLI: a shell on the user's device, or the cloud
 * sandbox (which routes `lh` commands to LobeHub). Without one of them enabled
 * or activatable, the receiving agent cannot run `lh message reply`.
 */
export const LH_COMMAND_TOOL_IDENTIFIERS = ['lobe-local-system', 'lobe-cloud-sandbox'];

export interface AgentSenderMessageConfig {
  /**
   * Whether the receiving agent has a tool that can run `lh` (see
   * {@link LH_COMMAND_TOOL_IDENTIFIERS}). Without it the header keeps the
   * attribution but asks for a relay through the user instead of a command it
   * could never run.
   */
  canRunLhCommand?: boolean;
  /**
   * T-198 G1 M2: session-scoped wrapper snapshot store and topic id. When both
   * are supplied the prepend header is solidified once per message and reused
   * byte-identically across operations. Omitted → legacy behaviour unchanged.
   */
  snapshotStore?: InjectionSnapshotStore;
  topicId?: string;
}

const escapeAttribute = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');

/**
 * The header that tells the model who sent an agent → agent message and how to
 * answer it. Without it the message reads exactly like the person typed it:
 * the model answers in its own conversation, where the sending agent never
 * sees the reply.
 */
export const formatAgentSenderHeader = (
  messageId: string,
  sender: AgentSenderMetadata,
  { canRunLhCommand = false }: AgentSenderMessageConfig = {},
) => {
  const attributes = [
    ['name', sender.name ?? sender.title],
    ['agent_id', sender.agentId],
    ['topic_id', sender.topicId],
    ['message_id', messageId],
  ]
    .filter((entry): entry is [string, string] => !!entry[1])
    .map(([key, value]) => `${key}="${escapeAttribute(value)}"`)
    .join(' ');

  // The reply is routed through the message's own origin, so it can only be
  // offered when the origin was kept (a private source shown in a shared
  // conversation is not), and only to an agent that can run commands at all.
  const instruction = !sender.topicId
    ? 'Sent by another agent, not typed by the user. Its conversation cannot be reached from here, so tell the user if it needs an answer.'
    : canRunLhCommand
      ? `Sent by another agent, not typed by the user. To answer that agent, run \`lh message reply ${messageId} -c "<your reply>"\`: the reply wakes its conversation. Your own response here is not delivered to it.`
      : 'Sent by another agent, not typed by the user. You cannot run commands here, so you cannot answer that agent directly and your response stays in this conversation: if it needs an answer, tell the user so they can pass it on.';

  return `<agent_sender ${attributes}>${instruction}</agent_sender>`;
};

/**
 * Agent Sender Message Processor
 *
 * A user message another agent sent (`lh topic send`, `lh message reply`,
 * `lh agent run`) carries `metadata.agentSender`, which the UI renders as the
 * author. This puts the same fact in front of the model, with how to reply.
 *
 * Must run before {@link MessageContentProcessor}, while user content is still
 * a string.
 */
export class AgentSenderMessageProcessor extends BaseProcessor {
  readonly name = 'AgentSenderMessageProcessor';

  constructor(
    private config: AgentSenderMessageConfig = {},
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);
    let processedCount = 0;
    const wrapperIds: Array<{ fingerprint: string; id: string; messageId: string }> = [];
    const { snapshotStore, topicId } = this.config;
    const useSnapshot = !!(snapshotStore && topicId);

    for (let i = 0; i < clonedContext.messages.length; i++) {
      const message = clonedContext.messages[i];
      const sender = message.metadata?.agentSender as AgentSenderMetadata | undefined;
      if (message.role !== 'user' || !sender?.agentId || typeof message.content !== 'string') {
        continue;
      }

      // Original prepend template, byte-for-byte (P5). Only the *source* of the
      // header becomes a solidified snapshot under M2.
      const header = formatAgentSenderHeader(message.id, sender, this.config);
      let injectedHeader = header;

      if (useSnapshot) {
        // Fingerprint from the message's immutable fields + the exact header,
        // never Date.now()/random (P2). The header already derives its message_id
        // attribute from message.id, so identical source ⇒ identical fingerprint.
        const fingerprint = Md5.hashStr(
          JSON.stringify({ header, messageId: message.id, role: message.role }),
        );
        const key = messageWrapperKey(topicId!, 'agentSender', message.id);
        let snapshot = snapshotStore!.get<WrapperSnapshot>(key);
        if (!snapshot) {
          snapshot = { fingerprint, payload: header };
          snapshotStore!.set(key, snapshot);
        }
        // Cross-operation reuse: always project the stored bytes.
        injectedHeader = snapshot.payload;
        wrapperIds.push({
          fingerprint: snapshot.fingerprint,
          id: wrapperBlockId('agentSender', message.id, snapshot.fingerprint),
          messageId: message.id,
        });
      }

      clonedContext.messages[i] = {
        ...message,
        content: `${injectedHeader}\n\n${message.content}`,
      };
      processedCount++;
    }

    clonedContext.metadata.agentSenderMessagesProcessed = processedCount;
    if (useSnapshot) clonedContext.metadata.agentSenderWrapperIds = wrapperIds;
    log('Marked %d agent-sent messages', processedCount);

    return this.markAsExecuted(clonedContext);
  }
}
