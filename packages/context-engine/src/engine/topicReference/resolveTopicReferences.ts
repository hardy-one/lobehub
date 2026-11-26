import type { TopicReferenceItem } from '../../providers/TopicReferenceContextInjector';

/**
 * Parsed `<refer_topic>` tag info
 */
export interface ParsedTopicReference {
  topicId: string;
  topicTitle?: string;
}

/**
 * Topic lookup result (common interface for both client store and server DB)
 */
export interface TopicLookupResult {
  historySummary?: string | null;
  title?: string | null;
}

/**
 * Message item returned by lookupMessages
 */
export interface TopicMessageItem {
  content?: string | null;
  role: string;
}

/** Max recent messages to fetch as fallback */
const MAX_RECENT_MESSAGES = 5;
/** Max characters per message content */
const MAX_MESSAGE_LENGTH = 300;

const RAW_TOPIC_ID = /(?:^|\W)tpc_[\dA-Za-z]{8,}(?![\dA-Za-z])/;

type TopicMessage = {
  content: string | unknown;
  id?: string;
  role?: string;
};

const unescapeMarkup = (raw: string) => raw.replaceAll(/\\([<>_*[\]()#`~|])/g, '$1');

/** Parse `<refer_topic>` tags from one message, in their written order. */
const parseMessageTopicTags = (raw: string): ParsedTopicReference[] => {
  const content = unescapeMarkup(raw);
  const refs: ParsedTopicReference[] = [];
  for (const match of content.matchAll(/<refer_topic\s([^>]*)>/g)) {
    const attrs = match[1];
    const idMatch = /\bid="([^"]+)"/.exec(attrs);
    if (!idMatch) continue;
    const nameMatch = /\bname="([^"]*)"/.exec(attrs);
    refs.push({ topicId: idMatch[1], topicTitle: nameMatch?.[1] });
  }
  return refs;
};

/**
 * Whether the messages point at another topic, either through a `<refer_topic>`
 * tag or a raw `tpc_` topic id the user pasted.
 */
export function mentionsTopic(messages: Array<{ content: string | unknown }>): boolean {
  if (parseReferTopicTags(messages).length > 0) return true;

  return messages.some((msg) => {
    const raw = typeof msg.content === 'string' ? msg.content : '';
    return RAW_TOPIC_ID.test(unescapeMarkup(raw));
  });
}

/**
 * Parse `<refer_topic>` tags from message contents
 * Topic ids are a set; the newest title wins.
 */
export function parseReferTopicTags(
  messages: Array<{ content: string | unknown }>,
): ParsedTopicReference[] {
  const topicIds = new Set<string>();
  const topicNames = new Map<string, string>();

  for (const msg of messages) {
    const raw = typeof msg.content === 'string' ? msg.content : '';
    for (const { topicId, topicTitle } of parseMessageTopicTags(raw)) {
      topicIds.add(topicId);
      if (topicTitle !== undefined) topicNames.set(topicId, topicTitle);
    }
  }

  return [...topicIds].map((topicId) => ({
    topicId,
    topicTitle: topicNames.get(topicId),
  }));
}

const truncate = (text: string, max: number) =>
  text.length <= max ? text : text.slice(0, max) + '...';

/** Resolve one topic reference, keeping the existing summary/fallback/unavailable semantics. */
const resolveOneTopic = async (
  { topicId, topicTitle }: ParsedTopicReference,
  lookupTopic: (topicId: string) => Promise<TopicLookupResult | null | undefined>,
  lookupMessages?: (topicId: string) => Promise<TopicMessageItem[]>,
): Promise<TopicReferenceItem> => {
  try {
    const topic = await lookupTopic(topicId);
    const title = topic?.title || topicTitle;

    if (topic?.historySummary) {
      return { summary: topic.historySummary, topicId, topicTitle: title };
    }

    // Fallback: fetch recent messages
    if (lookupMessages) {
      try {
        const allMessages = await lookupMessages(topicId);
        // Guard typeof: historical messages may carry non-string content.
        const recent = allMessages
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .filter((m) => typeof m.content === 'string' && m.content.trim())
          .slice(-MAX_RECENT_MESSAGES)
          .map((m) => ({
            content: truncate((m.content as string).trim(), MAX_MESSAGE_LENGTH),
            role: m.role,
          }));

        if (recent.length > 0) return { recentMessages: recent, topicId, topicTitle: title };
      } catch {
        // fallthrough to no-context
      }
    }

    return { topicId, topicTitle: title };
  } catch {
    return { topicId, topicTitle };
  }
};

/**
 * Resolve topic references by looking up each topic via the provided function.
 * Works with both sync (client store) and async (server DB) data sources.
 *
 * When a topic has no historySummary and lookupMessages is provided,
 * fetches the last 5 user/assistant messages as fallback context (each truncated to 300 chars).
 */
export async function resolveTopicReferences(
  messages: Array<{ content: string | unknown }>,
  lookupTopic: (topicId: string) => Promise<TopicLookupResult | null | undefined>,
  lookupMessages?: (topicId: string) => Promise<TopicMessageItem[]>,
): Promise<TopicReferenceItem[] | undefined> {
  const parsed = parseReferTopicTags(messages);
  if (parsed.length === 0) return undefined;

  const refs = await Promise.all(
    parsed.map((p) => resolveOneTopic(p, lookupTopic, lookupMessages)),
  );
  return refs.length > 0 ? refs : undefined;
}

/**
 * Resolve `<refer_topic>` tags to the message that carried each tag, so the
 * block stays byte-identical when that message later becomes history. Lookup
 * and permission decisions stay live (the caller passes guarded lookups); only
 * the placement moves from "last user message" to "owning message".
 */
export async function resolveTopicReferencesByMessage(
  messages: TopicMessage[],
  lookupTopic: (topicId: string) => Promise<TopicLookupResult | null | undefined>,
  lookupMessages?: (topicId: string) => Promise<TopicMessageItem[]>,
): Promise<TopicReferenceItem[] | undefined> {
  const hasRoles = messages.some((msg) => msg.role !== undefined);
  const refs: TopicReferenceItem[] = [];

  for (let index = 0; index < messages.length; index++) {
    const msg = messages[index];
    if (hasRoles && msg.role !== 'user') continue;
    const raw = typeof msg.content === 'string' ? msg.content : '';
    const seen = new Set<string>();

    for (const parsed of parseMessageTopicTags(raw)) {
      if (seen.has(parsed.topicId)) continue;
      seen.add(parsed.topicId);
      const resolved = await resolveOneTopic(parsed, lookupTopic, lookupMessages);
      refs.push({ ...resolved, messageId: msg.id, messageIndex: index });
    }
  }

  return refs.length > 0 ? refs : undefined;
}
