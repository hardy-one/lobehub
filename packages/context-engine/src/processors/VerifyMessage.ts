import debug from 'debug';
import { Md5 } from 'ts-md5';

import { BaseProcessor } from '../base/BaseProcessor';
import { wrapperBlockId } from '../injection/MessageWrapperSnapshots';
import type { PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    verifyFeedbackSurfaced?: number;
    verifyMessagesRemoved?: number;
    /** T-200 G5: deterministic wrapper identity, recorded pre-cleanup for P2. */
    verifyMessageWrapperIds?: Array<{ fingerprint: string; id: string; messageId: string }>;
  }
}

const log = debug('context-engine:processor:VerifyMessageProcessor');

/**
 * Verify Message Processor
 *
 * `role='verify'` messages are the Agent Run delivery-checker cards. `verify` is
 * not a valid model role, so they never reach the model as-is. Two cases:
 *
 * - **UI-only card** (empty content): a plain pass/fail card — removed from the
 *   model context (still persisted + rendered in the conversation).
 * - **Repair feedback** (non-empty content): auto-repair persisted the failure
 *   feedback onto the card (see VerifyRepairService). Surface it as a `user`
 *   turn — wrapped in a `<delivery_check_feedback>` tag so the model reads it as
 *   the checker's instruction, not human input — so the repair run acts on it.
 *
 * T-209 (M2 · pure derivation): the wrapper is a PURE FUNCTION of the card's
 * immutable fields (id / content). Same source → same bytes on every
 * operation, so the `[0,k)` prefix is stable with no store write; changed
 * repair feedback is rendered immediately. Role conversion and the template are
 * byte-for-byte unchanged (P5).
 */
export class VerifyMessageProcessor extends BaseProcessor {
  readonly name = 'VerifyMessageProcessor';

  constructor(options: ProcessorOptions = {}) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);

    const before = clonedContext.messages.length;
    let surfaced = 0;
    const wrapperIds: Array<{ fingerprint: string; id: string; messageId: string }> = [];

    clonedContext.messages = clonedContext.messages.flatMap((message) => {
      if (message.role !== 'verify') return [message];

      // Pre-existing content extraction (byte-for-byte, P5): the card's own
      // leading/trailing whitespace is normalised here, exactly as before.
      const content = typeof message.content === 'string' ? message.content.trim() : '';
      // UI-only card with no repair feedback — drop it from the model context.
      if (!content) return [];

      // P2: identity derived only from the immutable source (no wall clock/random).
      const fingerprint = Md5.hashStr(JSON.stringify({ content, messageId: message.id }));
      wrapperIds.push({
        fingerprint,
        id: wrapperBlockId('verifyMessage', message.id, fingerprint),
        messageId: message.id,
      });

      surfaced += 1;
      return [
        {
          ...message,
          content: `<delivery_check_feedback>\n${content}\n</delivery_check_feedback>`,
          role: 'user' as const,
        },
      ];
    });

    const removed = before - clonedContext.messages.length;
    clonedContext.metadata.verifyMessagesRemoved = removed;
    clonedContext.metadata.verifyFeedbackSurfaced = surfaced;
    clonedContext.metadata.verifyMessageWrapperIds = wrapperIds;
    if (removed > 0) log(`Removed ${removed} empty verify message(s) from model context`);
    if (surfaced > 0) log(`Surfaced ${surfaced} verify feedback message(s) as user turn(s)`);

    return this.markAsExecuted(clonedContext);
  }
}
