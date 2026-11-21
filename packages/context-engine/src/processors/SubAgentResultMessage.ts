import debug from 'debug';
import { Md5 } from 'ts-md5';

import { BaseProcessor } from '../base/BaseProcessor';
import { wrapperBlockId } from '../injection/MessageWrapperSnapshots';
import type { PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    subAgentResultMessagesWrapped?: number;
    /** T-200 G2: deterministic wrapper identity, recorded pre-cleanup for P2. */
    subAgentResultWrapperIds?: Array<{ fingerprint: string; id: string; messageId: string }>;
  }
}

const log = debug('context-engine:processor:SubAgentResultMessageProcessor');

const escapeAttribute = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

/**
 * Sub-Agent Result Message Processor
 *
 * A background sub-agent (`callSubAgent` / `callAgent` with `runInBackground`)
 * reports back as a `user` message whose sender is that sub-agent
 * (`metadata.subAgentCallback`), with its answer as the content. The chat shows
 * it as the sub-agent speaking; the model must not read it as the human, so
 * the content is wrapped in `<sub_agent_result>` — whose `id` is what
 * `callSubAgent({ subAgentId })` takes to follow up.
 *
 * T-209 (M2 · pure derivation): the wrapper is a PURE FUNCTION of the message's
 * immutable fields (id / content / `subAgentCallback`). Every operation
 * recomputes it and gets byte-identical output for the same source, so the
 * `[0,k)` prefix stays stable without writing any store; a genuinely changed
 * sender/status/content is rendered immediately (functionality first, T-193
 * §3.1). Trigger conditions and the wrapper template stay byte-for-byte
 * unchanged (P5).
 */
export class SubAgentResultMessageProcessor extends BaseProcessor {
  readonly name = 'SubAgentResultMessageProcessor';

  constructor(options: ProcessorOptions = {}) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);

    let wrapped = 0;
    const wrapperIds: Array<{ fingerprint: string; id: string; messageId: string }> = [];

    clonedContext.messages = clonedContext.messages.map((message) => {
      const sender = message.metadata?.subAgentCallback;
      if (message.role !== 'user' || !sender || typeof message.content !== 'string') {
        return message;
      }

      // P2: deterministic identity derived ONLY from the immutable source (no
      // wall clock, no random). Recomputed each operation — never cached — so a
      // real change can never be masked.
      const fingerprint = Md5.hashStr(
        JSON.stringify({
          content: message.content,
          name: sender.name,
          status: sender.status,
          threadId: sender.threadId,
        }),
      );
      wrapperIds.push({
        fingerprint,
        id: wrapperBlockId('subAgentResult', message.id, fingerprint),
        messageId: message.id,
      });

      wrapped += 1;
      // Original wrapper template, byte-for-byte (P5) — same expression, same
      // identifiers as HEAD; only recomputed each operation from the source.
      return {
        ...message,
        content: `<sub_agent_result id="${escapeAttribute(sender.threadId)}" name="${escapeAttribute(sender.name)}" status="${sender.status}">\n${message.content.trim()}\n</sub_agent_result>`,
      };
    });

    clonedContext.metadata.subAgentResultMessagesWrapped = wrapped;
    clonedContext.metadata.subAgentResultWrapperIds = wrapperIds;
    if (wrapped > 0) log(`Wrapped ${wrapped} sub-agent result message(s)`);

    return this.markAsExecuted(clonedContext);
  }
}
