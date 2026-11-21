import debug from 'debug';
import { Md5 } from 'ts-md5';

import { BaseProcessor } from '../base/BaseProcessor';
import { wrapperBlockId } from '../injection/MessageWrapperSnapshots';
import type { PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    taskCallbackMessagesSurfaced?: number;
    /** T-200 G6: deterministic wrapper identity, recorded pre-cleanup for P2. */
    taskCallbackWrapperIds?: Array<{ fingerprint: string; id: string; messageId: string }>;
  }
}

const log = debug('context-engine:processor:TaskCallbackMessageProcessor');

/**
 * Task Callback Message Processor
 *
 * `role='taskCallback'` messages are the result-bridge cards: when a task
 * dispatched from this conversation finishes, the lifecycle injects one carrying
 * the handoff summary. `taskCallback` is not a valid model role, so
 * it can't reach the model as-is. We surface it as a `user` turn wrapped in a
 * `<task_result>` tag — so the creator agent reads it as the task reporting back
 * (not as human input) and continues the conversation off it.
 *
 * An empty-content card (no handoff text) is dropped from the model context; it
 * stays persisted + rendered as a UI-only card.
 *
 * T-209 (M2 · pure derivation): the wrapper is a PURE FUNCTION of the card's
 * immutable fields (id / content / `metadata.taskCallback`). Same source → same
 * bytes on every operation, so the `[0,k)` prefix is stable with no store
 * write; changed handoff text is rendered immediately. Role conversion and the
 * template stay byte-for-byte unchanged (P5).
 */
export class TaskCallbackMessageProcessor extends BaseProcessor {
  readonly name = 'TaskCallbackMessageProcessor';

  constructor(options: ProcessorOptions = {}) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);

    let surfaced = 0;
    const wrapperIds: Array<{ fingerprint: string; id: string; messageId: string }> = [];

    clonedContext.messages = clonedContext.messages.flatMap((message) => {
      if (message.role !== 'taskCallback') return [message];

      // Pre-existing content extraction (byte-for-byte, P5).
      const content = typeof message.content === 'string' ? message.content.trim() : '';
      // UI-only card with no handoff text — drop it from the model context.
      if (!content) return [];

      const callback = message.metadata?.taskCallback;
      const identifier = callback?.identifier ?? 'task';
      const reason = callback?.reason ?? 'done';

      // P2: identity derived only from the immutable source (no wall clock/random).
      const fingerprint = Md5.hashStr(
        JSON.stringify({
          content,
          identifier,
          reason,
          taskId: callback?.taskId,
        }),
      );
      wrapperIds.push({
        fingerprint,
        id: wrapperBlockId('taskCallback', message.id, fingerprint),
        messageId: message.id,
      });

      surfaced += 1;
      return [
        {
          ...message,
          content: `<task_result task="${identifier}"${callback?.taskId ? ` id="${callback.taskId}"` : ''} status="${reason}">\n${content}\n</task_result>`,
          role: 'user' as const,
        },
      ];
    });

    clonedContext.metadata.taskCallbackMessagesSurfaced = surfaced;
    clonedContext.metadata.taskCallbackWrapperIds = wrapperIds;
    if (surfaced > 0) log(`Surfaced ${surfaced} task-callback message(s) as user turn(s)`);

    return this.markAsExecuted(clonedContext);
  }
}
