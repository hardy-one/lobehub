import debug from 'debug';

import { BaseEveryUserContentProvider } from '../base/BaseEveryUserContentProvider';
import type { Message, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    topicReferenceCount?: number;
    topicReferenceInjected?: boolean;
  }
}

const log = debug('context-engine:provider:TopicReferenceContextInjector');

/**
 * Topic reference item
 */
export interface TopicReferenceItem {
  /** Message id that carried the tag, preferred over the index for stable ownership. */
  messageId?: string;
  /** Index of the user message that carried the tag, fallback when no id exists. */
  messageIndex?: number;
  /** Recent messages as fallback when no summary available */
  recentMessages?: Array<{ content: string; role: string }>;
  /** The topic's history summary (undefined if no summary available) */
  summary?: string;
  /** The topic ID */
  topicId: string;
  /** The topic title */
  topicTitle?: string;
}

export interface TopicReferenceContextInjectorConfig {
  /** Whether topic reference context injection is enabled */
  enabled?: boolean;
  /** Referenced topics (with or without summaries) */
  topicReferences?: TopicReferenceItem[];
}

/**
 * Format topic references for injection
 * Topics with summaries are inlined; topics without summaries prompt the agent to read them via `lh topic view`
 */
function formatRecentMessages(messages: Array<{ content: string; role: string }>): string {
  return messages
    .map((msg) => {
      const role = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : msg.role;
      return `**${role}**: ${msg.content}`;
    })
    .join('\n\n');
}

function formatTopicReferences(items: TopicReferenceItem[]): string | null {
  if (items.length === 0) return null;

  const withContext = items.filter((item) => item.summary || item.recentMessages?.length);
  const withoutContext = items.filter((item) => !item.summary && !item.recentMessages?.length);

  const lines: string[] = [
    '<referred_topics hint="The following are brief summaries or excerpts of referenced topics. For the complete conversation history, activate the lobehub skill and run `lh topic view` with the topic id.">',
  ];

  for (const item of withContext) {
    const title = item.topicTitle ? ` title="${item.topicTitle}"` : '';
    const type = item.summary ? 'summary' : 'recent_messages';
    lines.push(`<topic id="${item.topicId}"${title} type="${type}">`);
    if (item.summary) {
      lines.push(item.summary);
    } else {
      lines.push(formatRecentMessages(item.recentMessages!));
    }
    lines.push('</topic>');
  }

  if (withoutContext.length > 0) {
    lines.push(
      '<pending_topics hint="No context available for the following topics. Activate the lobehub skill and run `lh topic view` with the topic id to read their conversation history.">',
    );
    for (const item of withoutContext) {
      const title = item.topicTitle ? ` title="${item.topicTitle}"` : '';
      lines.push(`<topic id="${item.topicId}"${title} />`);
    }
    lines.push('</pending_topics>');
  }

  lines.push('</referred_topics>');

  return lines.join('\n');
}

/**
 * Topic Reference Context Injector
 *
 * When user messages contain <refer_topic> tags referencing other topics,
 * appends the referenced topics' context to the message that carried each tag
 * (not whichever message happens to be last), so the block stays byte-identical
 * when the message becomes history.
 * - Topics with summaries: summary is inlined directly
 * - Topics without summaries: a hint is added prompting the agent to read them via `lh topic view`
 */
export class TopicReferenceContextInjector extends BaseEveryUserContentProvider {
  readonly name = 'TopicReferenceContextInjector';

  constructor(
    private config: TopicReferenceContextInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected buildContentForMessage(
    message: Message,
    index: number,
  ): { content: string; contextType: string } | null {
    if (
      !this.config.enabled ||
      !this.config.topicReferences?.length ||
      message.meta?.systemInjection ||
      message.meta?.virtualLastUser
    ) {
      return null;
    }

    const references = this.config.topicReferences.filter(
      (item) =>
        (item.messageId && item.messageId === message.id) ||
        (!item.messageId && item.messageIndex === index),
    );
    if (references.length === 0) return null;

    const content = message.content;
    const text =
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content
              .filter((part: any) => part?.type === 'text')
              .map((part: any) => part.text ?? '')
              .join('\n')
          : '';
    if (text.includes('<topic_reference_context>')) return null;

    const formattedContent = formatTopicReferences(references);
    if (!formattedContent) return null;

    log('Topic reference context injected for message %s', message.id ?? index);
    return { content: formattedContent, contextType: 'topic_reference_context' };
  }
}
