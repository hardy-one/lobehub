import type { EmojiReaction } from '@lobechat/types';
import debug from 'debug';
import { Md5 } from 'ts-md5';

import { BaseProcessor } from '../base/BaseProcessor';
import { wrapperBlockId } from '../injection/MessageWrapperSnapshots';
import type { PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    reactionFeedbackProcessed?: number;
    /** T-200 G7: deterministic wrapper identity, recorded pre-cleanup for P2. */
    reactionFeedbackWrapperIds?: Array<{ fingerprint: string; id: string; messageId: string }>;
  }
}

const log = debug('context-engine:processor:ReactionFeedbackProcessor');

export interface ReactionFeedbackConfig {
  /** Whether to enable reaction feedback injection */
  enabled?: boolean;
}

/**
 * Reaction Feedback Processor
 * Converts emoji reactions on assistant messages to feedback text
 * and injects into the next user message, where the model will actually attend to it.
 *
 * T-209 (M2 · pure derivation): the prepended tag is a PURE FUNCTION of the
 * already-persisted `metadata.reactions` of the preceding assistant message(s)
 * plus the target user message id. Same source → same bytes on every
 * operation, so the `[0,k)` prefix is stable with no store write; a newly added
 * reaction is prepended immediately. Trigger logic (collection, injection into
 * the next user message, pending reset) and the tag template are byte-for-byte
 * unchanged (P5).
 */
export class ReactionFeedbackProcessor extends BaseProcessor {
  readonly name = 'ReactionFeedbackProcessor';

  constructor(
    private config: ReactionFeedbackConfig = {},
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    if (!this.config.enabled) {
      return this.markAsExecuted(context);
    }

    const clonedContext = this.cloneContext(context);
    let processedCount = 0;
    const wrapperIds: Array<{ fingerprint: string; id: string; messageId: string }> = [];

    // Collect emojis from assistant messages, then inject into the next user message
    let pendingEmojis: string[] = [];

    for (let i = 0; i < clonedContext.messages.length; i++) {
      const message = clonedContext.messages[i];

      // Collect reactions from assistant messages
      if (message.role === 'assistant' && message.metadata?.reactions) {
        const reactions = message.metadata.reactions as EmojiReaction[];
        const emojis = reactions.map((r) => r.emoji).filter(Boolean);

        if (emojis.length > 0) {
          pendingEmojis.push(...emojis);
          log(`Collected reaction emojis from message ${message.id}: ${emojis.join(' ')}`);
        }
      }

      // Inject accumulated feedback into the next user message
      if (message.role === 'user' && pendingEmojis.length > 0) {
        const originalContent = message.content;

        if (typeof originalContent === 'string') {
          // Original prepend template, byte-for-byte (P5).
          const feedbackTag = `[User Feedback Emoji: ${pendingEmojis.join(' ')}]`;

          // P2: identity derived only from the immutable source (reaction emojis
          // already persisted in assistant metadata + target user message id).
          const fingerprint = Md5.hashStr(
            JSON.stringify({ emojis: pendingEmojis, messageId: message.id }),
          );
          wrapperIds.push({
            fingerprint,
            id: wrapperBlockId('reactionFeedback', message.id, fingerprint),
            messageId: message.id,
          });

          clonedContext.messages[i] = {
            ...message,
            content: `${feedbackTag}\n\n${originalContent}`,
          };
          processedCount += pendingEmojis.length;
        }

        pendingEmojis = [];
      }
    }

    clonedContext.metadata.reactionFeedbackProcessed = processedCount;
    clonedContext.metadata.reactionFeedbackWrapperIds = wrapperIds;
    log(`Reaction feedback processing completed, processed ${processedCount} messages`);

    return this.markAsExecuted(clonedContext);
  }
}
