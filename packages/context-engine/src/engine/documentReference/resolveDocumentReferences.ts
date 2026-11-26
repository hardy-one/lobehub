import type { DocumentReferenceItem } from '../../providers/DocumentReferenceContextInjector';

/** Parsed `<refer_document>` tag info */
export interface ParsedDocumentReference {
  documentId: string;
  /** Whether the latest user message carries this tag. */
  latest: boolean;
  title?: string;
}

/** Document lookup result (common interface for client and server sources) */
export interface DocumentLookupResult {
  content?: string | null;
  title?: string | null;
}

/** Character budget per referenced document. */
export const MAX_DOCUMENT_REFERENCE_CHARS = 20_000;
/** Most documents listed for a single request, counted separately for latest and earlier turns. */
export const MAX_DOCUMENT_REFERENCES = 5;

type ReferenceMessage = { content: string | unknown; id?: string; role?: string };

const findLatestUserIndex = (messages: ReferenceMessage[]) => {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return i;
  }
  return messages.length - 1;
};

// Both resolvers below read the very same tag shape. Keeping one parser avoids
// the per-message injection and the current-turn lookup disagreeing about what
// a `<refer_document>` tag is.
const TAG_PATTERN = /<refer_document\s([^>]*)>/g;
const unescapeMarkup = (raw: string) => raw.replaceAll(/\\([<>_*[\]()#`~|])/g, '$1');

const parseMessageTags = (raw: string): Array<{ documentId: string; title?: string }> => {
  const content = unescapeMarkup(raw);
  const tags: Array<{ documentId: string; title?: string }> = [];
  for (const match of content.matchAll(TAG_PATTERN)) {
    const attrs = match[1];
    const idMatch = /\bid="([^"]+)"/.exec(attrs);
    if (!idMatch) continue;
    const nameMatch = /\bname="([^"]*)"/.exec(attrs);
    tags.push({ documentId: idMatch[1], title: nameMatch?.[1] });
  }
  return tags;
};

const onlyUserMessages = (messages: ReferenceMessage[]) =>
  messages.some((msg) => msg.role !== undefined);

/**
 * Parse `<refer_document>` tags from message contents, ordered by last use. The
 * injection is rebuilt on every request, so tags from earlier turns are kept:
 * dropping them would hide that the document was referenced at all.
 */
export function parseReferDocumentTags(messages: ReferenceMessage[]): ParsedDocumentReference[] {
  const refs = new Map<string, ParsedDocumentReference>();
  const latestUserIndex = findLatestUserIndex(messages);
  const hasRoles = onlyUserMessages(messages);

  messages.forEach((msg, index) => {
    // Only the user writes these tags; an assistant or tool echo must not add
    // or re-order references.
    if (hasRoles && msg.role !== 'user') return;
    const raw = typeof msg.content === 'string' ? msg.content : '';
    for (const { documentId, title } of parseMessageTags(raw)) {
      const previous = refs.get(documentId);
      // Re-insert so Map order follows the most recent use.
      refs.delete(documentId);
      refs.set(documentId, {
        documentId,
        latest: index === latestUserIndex,
        title: title || previous?.title,
      });
    }
  });

  return [...refs.values()];
}

/**
 * Resolve document references through the provided lookup. Only documents the
 * latest user message references are read and inlined; earlier ones are listed
 * by id so the agent can read them on demand, which keeps a long topic from
 * re-sending every document on every turn. `inlineEarlierTurns` inlines them
 * too, for agents that cannot read documents on demand. A lookup that returns nothing
 * (missing, or not readable by this run) leaves the reference without content.
 */
export async function resolveDocumentReferences(
  messages: ReferenceMessage[],
  lookupDocument: (documentId: string) => Promise<DocumentLookupResult | null | undefined>,
  { inlineEarlierTurns = false }: { inlineEarlierTurns?: boolean } = {},
): Promise<DocumentReferenceItem[] | undefined> {
  const parsed = parseReferDocumentTags(messages);
  if (parsed.length === 0) return undefined;

  const isInlined = (ref: ParsedDocumentReference) => ref.latest || inlineEarlierTurns;
  // Keep the most recent references when a conversation exceeds the cap.
  const earlier = parsed.filter((ref) => !isInlined(ref)).slice(-MAX_DOCUMENT_REFERENCES);
  const latest = parsed.filter(isInlined).slice(-MAX_DOCUMENT_REFERENCES);

  const refs: DocumentReferenceItem[] = earlier.map(({ documentId, title }) => ({
    documentId,
    earlierTurn: true,
    title,
  }));

  for (const { documentId, title } of latest) {
    try {
      const doc = await lookupDocument(documentId);
      const resolvedTitle = doc?.title || title;
      const content = typeof doc?.content === 'string' ? doc.content : undefined;

      if (content === undefined) {
        refs.push({ documentId, title: resolvedTitle });
        continue;
      }

      const truncated = content.length > MAX_DOCUMENT_REFERENCE_CHARS;
      refs.push({
        content: truncated ? content.slice(0, MAX_DOCUMENT_REFERENCE_CHARS) : content,
        documentId,
        title: resolvedTitle,
        ...(truncated && { truncated }),
      });
    } catch {
      refs.push({ documentId, title });
    }
  }

  return refs;
}

/**
 * Resolve references to the message that actually carries each `<refer_document>`
 * tag and attach them there, instead of to whichever message happens to be last.
 * A message reads its own document the same way on the turn it is sent and on
 * every later turn, so the block stays byte-identical as the conversation grows.
 *
 * Lookup and permission decisions remain live: a deleted, unbound or revoked
 * document still resolves to `unavailable` from `findAgentDocument`, never to a
 * frozen copy of its old text. The existing per-document character budget and
 * the per-message reference cap are kept unchanged.
 */
export async function resolveDocumentReferencesByMessage(
  messages: ReferenceMessage[],
  lookupDocument: (documentId: string) => Promise<DocumentLookupResult | null | undefined>,
): Promise<DocumentReferenceItem[] | undefined> {
  const hasRoles = onlyUserMessages(messages);
  const refs: DocumentReferenceItem[] = [];

  for (let index = 0; index < messages.length; index++) {
    const msg = messages[index];
    if (hasRoles && msg.role !== 'user') continue;
    const raw = typeof msg.content === 'string' ? msg.content : '';
    const seen = new Set<string>();

    for (const { documentId, title } of parseMessageTags(raw)) {
      if (seen.has(documentId)) continue;
      if (seen.size >= MAX_DOCUMENT_REFERENCES) break;
      seen.add(documentId);

      try {
        const doc = await lookupDocument(documentId);
        const resolvedTitle = doc?.title || title;
        const content = typeof doc?.content === 'string' ? doc.content : undefined;

        if (content === undefined) {
          refs.push({ documentId, messageId: msg.id, messageIndex: index, title: resolvedTitle });
          continue;
        }

        const truncated = content.length > MAX_DOCUMENT_REFERENCE_CHARS;
        refs.push({
          content: truncated ? content.slice(0, MAX_DOCUMENT_REFERENCE_CHARS) : content,
          documentId,
          messageId: msg.id,
          messageIndex: index,
          title: resolvedTitle,
          ...(truncated && { truncated }),
        });
      } catch {
        refs.push({ documentId, messageId: msg.id, messageIndex: index, title });
      }
    }
  }

  return refs.length > 0 ? refs : undefined;
}
