import debug from 'debug';
import { template } from 'es-toolkit/compat';
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
    inputTemplateProcessed?: number;
    /** T-198 G3: deterministic wrapper identity, recorded pre-cleanup for P2. */
    inputTemplateWrapperIds?: Array<{ fingerprint: string; id: string; messageId: string }>;
  }
}

const log = debug('context-engine:processor:InputTemplateProcessor');

export interface InputTemplateConfig {
  /** Input message template string */
  inputTemplate?: string;
  /**
   * T-198 G3 M2: session-scoped wrapper snapshot store and topic id. When both
   * are supplied, the interpolated template result is solidified once per
   * message and reused byte-identically across operations. Omitted → legacy.
   */
  snapshotStore?: InjectionSnapshotStore;
  topicId?: string;
}

/**
 * Input Template Processor
 * Responsible for applying input message templates to user messages
 */
export class InputTemplateProcessor extends BaseProcessor {
  readonly name = 'InputTemplateProcessor';

  constructor(
    private config: InputTemplateConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);

    // Skip processing if no template is configured
    if (!this.config.inputTemplate) {
      log('No input template configured, skipping processing');
      return this.markAsExecuted(clonedContext);
    }

    let processedCount = 0;
    const wrapperIds: Array<{ fingerprint: string; id: string; messageId: string }> = [];
    const { snapshotStore, topicId } = this.config;
    const useSnapshot = !!(snapshotStore && topicId);

    try {
      // Compile the template
      const compiler = template(this.config.inputTemplate, {
        interpolate: /\{\{\s*(text)\s*\}\}/g,
      });

      log(`Applying input template: ${this.config.inputTemplate}`);

      // Process each message
      for (let i = 0; i < clonedContext.messages.length; i++) {
        const message = clonedContext.messages[i];

        // Only apply template to what the human typed — not to a background
        // sub-agent's report, which arrives as a user message from that sub-agent
        if (message.role === 'user' && !message.metadata?.subAgentCallback) {
          try {
            const originalContent = message.content;

            // T-198 G3 M2: fingerprint from immutable template config + original
            // text; the interpolated result is solidified once and reused so a
            // later operation cannot re-interpolate into different bytes.
            const key = messageWrapperKey(topicId!, 'inputTemplate', message.id);
            let processedContent: string;
            if (useSnapshot) {
              const fingerprint = Md5.hashStr(
                JSON.stringify({ inputTemplate: this.config.inputTemplate, originalContent }),
              );
              let snapshot = snapshotStore!.get<WrapperSnapshot>(key);
              if (!snapshot) {
                snapshot = {
                  fingerprint,
                  payload: compiler({ text: originalContent }),
                };
                snapshotStore!.set(key, snapshot);
              }
              processedContent = snapshot.payload;
              wrapperIds.push({
                fingerprint: snapshot.fingerprint,
                id: wrapperBlockId('inputTemplate', message.id, snapshot.fingerprint),
                messageId: message.id,
              });
            } else {
              processedContent = compiler({ text: originalContent });
            }

            if (processedContent !== originalContent) {
              clonedContext.messages[i] = {
                ...message,
                content: processedContent,
              };
              processedCount++;
              log(`Applied template to message ${message.id}`);
            }
          } catch (error) {
            log.extend('error')(`Error applying template to message ${message.id}: ${error}`);
            // Keep original message on error
          }
        }
      }
    } catch (error) {
      log.extend('error')(`Template compilation failed: ${error}`);
      // Skip processing if template compilation fails
    }

    // Update metadata
    clonedContext.metadata.inputTemplateProcessed = processedCount;
    if (useSnapshot) clonedContext.metadata.inputTemplateWrapperIds = wrapperIds;

    log(`Input template processing completed, processed ${processedCount} messages`);

    return this.markAsExecuted(clonedContext);
  }
}
