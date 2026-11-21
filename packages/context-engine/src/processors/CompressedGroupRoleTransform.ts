import debug from 'debug';
import { Md5 } from 'ts-md5';

import { BaseProcessor } from '../base/BaseProcessor';
import { wrapperBlockId } from '../injection/MessageWrapperSnapshots';
import type { Message, PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    compressedGroupRoleTransformProcessed?: number;
    /** T-200 G12: deterministic wrapper identity, recorded pre-cleanup for P2. */
    compressedGroupWrapperIds?: Array<{ fingerprint: string; id: string; messageId: string }>;
  }
}

const log = debug('context-engine:processor:CompressedGroupRoleTransformProcessor');

/**
 * Compressed Group Role Transform Processor
 *
 * Transforms messages with role='compressedGroup' to role='user' before
 * sending to the model. The 'compressedGroup' role is used for UI rendering
 * to display compressed/summarized conversation history, but models don't
 * understand this role.
 *
 * The compressed summary content is wrapped in a system context block to
 * provide historical context to the model.
 *
 * Flow:
 * 1. DB stores compression groups with role='compressedGroup'
 * 2. conversation-flow passes them through for UI rendering
 * 3. This processor transforms to role='user' with wrapped content before model API call
 *
 * T-209 (M2 · pure derivation): the wrapper is a PURE FUNCTION of the persisted
 * summary content and message id. Same source → same bytes on every operation,
 * so the `[0,k)` prefix is stable with no store write; a regenerated summary is
 * rendered immediately. Role conversion and the template stay byte-for-byte
 * unchanged (P5).
 */
export class CompressedGroupRoleTransformProcessor extends BaseProcessor {
  readonly name = 'CompressedGroupRoleTransformProcessor';

  constructor(options: ProcessorOptions = {}) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);

    let processedCount = 0;
    const wrapperIds: Array<{ fingerprint: string; id: string; messageId: string }> = [];

    clonedContext.messages = clonedContext.messages.map((msg: Message) => {
      if (msg.role === 'compressedGroup') {
        processedCount++;
        log(`Transforming compressedGroup message to user role`);

        // Original wrapper template, byte-for-byte (P5). Role conversion unchanged.
        const wrappedContent = msg.content
          ? `<compressed_history_summary>\n${msg.content}\n</compressed_history_summary>`
          : '';

        // P2: identity derived only from the persisted summary (no wall clock/random).
        const fingerprint = Md5.hashStr(
          JSON.stringify({ content: msg.content, messageId: msg.id }),
        );
        wrapperIds.push({
          fingerprint,
          id: wrapperBlockId('compressedGroup', msg.id, fingerprint),
          messageId: msg.id,
        });

        return {
          ...msg,
          content: wrappedContent,
          role: 'user',
        };
      }

      return msg;
    });

    // Update metadata
    clonedContext.metadata.compressedGroupRoleTransformProcessed = processedCount;
    clonedContext.metadata.compressedGroupWrapperIds = wrapperIds;

    log(`Compressed group role transform completed: ${processedCount} messages processed`);

    return this.markAsExecuted(clonedContext);
  }
}
