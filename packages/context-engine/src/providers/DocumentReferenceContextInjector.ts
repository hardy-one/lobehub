import debug from 'debug';
import { Md5 } from 'ts-md5';

import { BaseLastUserContentProvider } from '../base/BaseLastUserContentProvider';
import type { InjectionSnapshotStore } from '../injection/InjectionSnapshotStore';
import { findLastRealUserIndex, makeTailMessage, toEpoch } from '../injection/lastUserInjection';
import type { Message, PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    documentReferenceCount?: number;
    documentReferenceInjected?: boolean;
    documentReferenceInjectionCreatedAt?: number;
    /** T-202 P2: source-derived tail-slot identity (no Date.now()/random). */
    documentReferenceInjectionId?: string;
  }
}

const log = debug('context-engine:provider:DocumentReferenceContextInjector');

/** An agent document the user referenced with a `<refer_document>` tag. */
export interface DocumentReferenceItem {
  /** Document content, cut to the injection budget; absent when it could not be read. */
  content?: string;
  /** Agent-document id carried by the tag (`agent_documents.id`). */
  documentId: string;
  /** Referenced in an earlier turn only, so listed without content. */
  earlierTurn?: boolean;
  /** Document title */
  title?: string;
  /** Whether `content` was cut short of the full document */
  truncated?: boolean;
}

export interface DocumentReferenceContextInjectorConfig {
  /**
   * Whether this request is sent the lobe-agent-documents tool. Without it the hint
   * must not promise a `readDocument` call the model cannot make.
   */
  canReadDocuments?: boolean;
  documentReferences?: DocumentReferenceItem[];
  enabled?: boolean;
  /** T-202 / C8 (M2): interface symmetry only, UNUSED — pure derivation, no store write. */
  snapshotStore?: InjectionSnapshotStore;
  topicId?: string;
}

const escapeAttr = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');

const READABLE_HINT =
  'The user referenced the following agent documents. Use their content as context. When a document is marked truncated, earlier_turn or unavailable, read it in full with the lobe-agent-documents readDocument tool using its id.';
const UNREADABLE_HINT =
  'The user referenced the following agent documents. Use their content as context. A document marked truncated only includes its beginning, and one marked earlier_turn or unavailable has no content here; you cannot read more of them in this conversation, so tell the user when the answer depends on the missing part.';

const formatDocumentReferences = (
  items: DocumentReferenceItem[],
  canReadDocuments: boolean,
): string | null => {
  if (items.length === 0) return null;

  const lines: string[] = [
    `<referred_documents hint="${canReadDocuments ? READABLE_HINT : UNREADABLE_HINT}">`,
  ];

  for (const item of items) {
    const attrs = [
      `id="${escapeAttr(item.documentId)}"`,
      item.title ? `title="${escapeAttr(item.title)}"` : undefined,
      item.truncated ? 'truncated="true"' : undefined,
    ]
      .filter(Boolean)
      .join(' ');

    if (item.earlierTurn) {
      lines.push(`<document ${attrs} status="earlier_turn" />`);
      continue;
    }

    if (item.content === undefined) {
      lines.push(`<document ${attrs} status="unavailable" />`);
      continue;
    }

    lines.push(`<document ${attrs}>`, item.content, '</document>');
  }

  lines.push('</referred_documents>');

  return lines.join('\n');
};

/**
 * Document Reference Context Injector
 *
 * When user messages contain `<refer_document>` tags, appends the referenced
 * agent documents' content to the last user message.
 */
export class DocumentReferenceContextInjector extends BaseLastUserContentProvider {
  readonly name = 'DocumentReferenceContextInjector';

  constructor(
    private config: DocumentReferenceContextInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);
    const references = this.config.documentReferences;

    if (!this.config.enabled || !references || references.length === 0) {
      log('Document reference not enabled or no references, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    const formattedContent = formatDocumentReferences(references, !!this.config.canReadDocuments);
    if (!formattedContent) return this.markAsExecuted(clonedContext);

    const lastUserIndex = findLastRealUserIndex(clonedContext.messages);
    if (lastUserIndex === -1) {
      log('No user messages found, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    // T-202 批 B 剩余 / C8: project into a deterministic virtual tail slot.
    // P5: ORIGINAL wrapper-branch template kept verbatim (byte-for-byte the
    // pre-change branch expressions); only PLACEMENT changed.
    const hasExistingWrapper = this.hasExistingSystemContext(clonedContext);
    const contentToAppend = hasExistingWrapper
      ? this.createContextBlock(formattedContent, 'document_reference_context')
      : this.wrapWithSystemContext(formattedContent, 'document_reference_context');

    // Source-derived identity: fingerprint of immutable refer_document ids → id.
    const fingerprint = Md5.hashStr(
      references
        .map((r) => r.documentId)
        .sort()
        .join('|'),
    );
    const injectionId = `inject:lastUser:documentReference:${fingerprint}`;
    const carrierCreatedAt = toEpoch((clonedContext.messages[lastUserIndex] as Message).createdAt);

    const tailMessage = makeTailMessage({
      content: contentToAppend,
      createdAt: carrierCreatedAt,
      id: injectionId,
      injectType: 'document-reference',
    });
    clonedContext.messages.push(tailMessage);

    // T-202 / C8 is M2 pure derivation: it writes NOTHING to any store. Tail-slot
    // bytes come solely from the immutable refer_document message tags; no store write.

    clonedContext.metadata.documentReferenceInjectionId = injectionId;
    clonedContext.metadata.documentReferenceInjectionCreatedAt = carrierCreatedAt;
    clonedContext.metadata.documentReferenceInjected = true;
    clonedContext.metadata.documentReferenceCount = references.length;

    return this.markAsExecuted(clonedContext);
  }
}
