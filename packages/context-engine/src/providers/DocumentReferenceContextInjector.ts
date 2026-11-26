import { BaseEveryUserContentProvider } from '../base/BaseEveryUserContentProvider';
import type { Message, PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    documentReferenceCount?: number;
    documentReferenceInjected?: boolean;
  }
}

/** An agent document the user referenced with a `<refer_document>` tag. */
export interface DocumentReferenceItem {
  /** Document content, cut to the injection budget; absent when it could not be read. */
  content?: string;
  /** Agent-document id carried by the tag (`agent_documents.id`). */
  documentId: string;
  /** Referenced in an earlier turn only, so listed without content. */
  earlierTurn?: boolean;
  /** Message id that carried the tag, preferred over the index for stable ownership. */
  messageId?: string;
  /** Index of the user message that carried the tag, fallback when no id exists. */
  messageIndex?: number;
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

const messageText = (content: Message['content']): string => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((part: any) => part?.type === 'text' && typeof part.text === 'string')
      .map((part: any) => part.text as string)
      .join('\n');
  }
  return '';
};

/**
 * Document Reference Context Injector
 *
 * When user messages contain `<refer_document>` tags, appends the referenced
 * agent documents' content to the message that carried each tag. Resolving the
 * reference on every request keeps permission and deletion decisions current;
 * attaching it to its own message keeps an earlier turn byte-identical when it
 * becomes history.
 */
export class DocumentReferenceContextInjector extends BaseEveryUserContentProvider {
  readonly name = 'DocumentReferenceContextInjector';

  private injectedCount = 0;

  constructor(
    private config: DocumentReferenceContextInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected buildContentForMessage(
    message: Message,
    index: number,
  ): { content: string; contextType: string } | null {
    if (!this.config.enabled || !this.config.documentReferences?.length) return null;
    if (message.meta?.systemInjection || message.meta?.virtualLastUser) return null;

    const references = this.config.documentReferences.filter(
      (item) =>
        (item.messageId && item.messageId === message.id) ||
        (!item.messageId && item.messageIndex === index),
    );
    if (references.length === 0) return null;

    // Replaying already-processed content must not append a second block.
    if (messageText(message.content).includes('<document_reference_context>')) return null;

    const formattedContent = formatDocumentReferences(references, !!this.config.canReadDocuments);
    if (!formattedContent) return null;

    this.injectedCount += references.length;
    return { content: formattedContent, contextType: 'document_reference_context' };
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    this.injectedCount = 0;
    const result = await super.doProcess(context);

    if (this.injectedCount > 0) {
      result.metadata.documentReferenceInjected = true;
      result.metadata.documentReferenceCount = this.injectedCount;
    }

    return result;
  }
}
