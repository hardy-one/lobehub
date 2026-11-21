import { escapeXmlAttr, formatPageContentContext } from '@lobechat/prompts';
import type { RuntimeActiveTopicDocumentContext } from '@lobechat/types';
import debug from 'debug';

import { BaseLastUserContentProvider } from '../base/BaseLastUserContentProvider';
import {
  type InjectionSnapshotStore,
  lastUserActiveDocKey,
} from '../injection/InjectionSnapshotStore';
import {
  appendSegmentToRealUser,
  findLastRealUserIndex,
  toEpoch,
} from '../injection/lastUserInjection';
import type { Message, PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    activeTopicDocumentContextInjected?: boolean;
    activeTopicDocumentContextInjectionCreatedAt?: number;
    /** T-202 P2: source-derived identity of the C1 segment (no Date.now()/random). */
    activeTopicDocumentContextInjectionId?: string;
  }
}

const log = debug('context-engine:provider:ActiveTopicDocumentContextInjector');

export interface ActiveTopicDocumentContextInjectorConfig {
  activeTopicDocument?: RuntimeActiveTopicDocumentContext;
  enabled?: boolean;
  /**
   * T-202 批 B 剩余 / C1 (M1): session-scoped snapshot store. The first matching
   * request writes `topicId:lastUser:activeDoc`; later operations reuse it.
   */
  snapshotStore?: InjectionSnapshotStore;
  topicId?: string;
}

const formatActiveTopicDocumentContext = (document: RuntimeActiveTopicDocumentContext) => {
  const attrs = [
    `document_id="${escapeXmlAttr(document.documentId)}"`,
    document.agentDocumentId
      ? `agent_document_id="${escapeXmlAttr(document.agentDocumentId)}"`
      : undefined,
    document.title ? `title="${escapeXmlAttr(document.title)}"` : undefined,
  ]
    .filter(Boolean)
    .join(' ');

  const snapshot = document.snapshot
    ? `<current_document_snapshot>
${formatPageContentContext(document.snapshot)}
</current_document_snapshot>`
    : '';

  return `<document ${attrs} />
${snapshot}
<guidance>
The current conversation is not inside the page editor. Do not use PageAgent editor tools.
When the user asks to continue editing this topic document, use lobe-agent-documents tools instead.
Use the injected current document snapshot when it is sufficient for the requested change.
Call readDocument with format="xml" only when the injected snapshot is missing, stale, or insufficient.
Prefer modifyNodes with agent_document_id when it is present.
If agent_document_id is missing, call listDocuments with scope="currentTopic" and match document_id.
</guidance>`;
};

/**
 * Appends the active-topic-document context to the last REAL user message.
 *
 * T-202 批 B 剩余 / C1: M1 solidification + §2.7.1 P-branch segment order 1.
 * The first matching request captures the formatted block into
 * `topicId:lastUser:activeDoc`; later operations reuse that exact value, so the
 * segment appended at u.content byte end is stable. Trigger condition and text
 * template are verbatim (P5); only identity/createdAt/placement are changed.
 */
export class ActiveTopicDocumentContextInjector extends BaseLastUserContentProvider {
  readonly name = 'ActiveTopicDocumentContextInjector';

  constructor(
    private config: ActiveTopicDocumentContextInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);
    const { activeTopicDocument, enabled } = this.config;

    // Original trigger expression, verbatim (P5).
    if (!enabled || !activeTopicDocument?.documentId) {
      log('No active topic document context, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    // M1: first matching request writes the formatted block; later operations
    // reuse the snapshot bytes verbatim even if the live document changed.
    const { snapshotStore, topicId } = this.config;
    let formattedContent = formatActiveTopicDocumentContext(activeTopicDocument);
    if (snapshotStore && topicId) {
      const key = lastUserActiveDocKey(topicId);
      const stored = snapshotStore.get<string>(key);
      if (stored !== undefined) {
        formattedContent = stored;
      } else {
        snapshotStore.set(key, formattedContent);
      }
    }

    const lastUserIndex = findLastRealUserIndex(clonedContext.messages);

    if (lastUserIndex === -1) {
      log('No user messages found, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    // P5: the ORIGINAL wrapper-branch template is kept verbatim. Both branches
    // below are byte-for-byte the pre-change expressions from this file. Only
    // the PLACEMENT changed: the resulting text is appended at u.content byte
    // end (§2.7.1) instead of merged into an existing wrapper.
    const hasExistingWrapper = this.hasExistingSystemContext(clonedContext);
    const contentToAppend = hasExistingWrapper
      ? this.createContextBlock(formattedContent, 'active_topic_document')
      : this.wrapWithSystemContext(formattedContent, 'active_topic_document');

    // §2.7.1: append the exact template output at the real user's content byte end.
    const realUser = clonedContext.messages[lastUserIndex];
    appendSegmentToRealUser(clonedContext, lastUserIndex, contentToAppend);

    // Source-derived identity (M1 key + real user createdAt), no now()/random.
    const injectionId = `inject:lastUser:activeDoc:${topicId ?? 'legacy'}`;
    clonedContext.metadata.activeTopicDocumentContextInjectionId = injectionId;
    clonedContext.metadata.activeTopicDocumentContextInjectionCreatedAt = toEpoch(
      (realUser as Message).createdAt,
    );

    clonedContext.metadata.activeTopicDocumentContextInjected = true;

    return this.markAsExecuted(clonedContext);
  }
}
