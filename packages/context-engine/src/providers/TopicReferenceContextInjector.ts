import debug from 'debug';
import { Md5 } from 'ts-md5';

import { BaseLastUserContentProvider } from '../base/BaseLastUserContentProvider';
import type { InjectionSnapshotStore } from '../injection/InjectionSnapshotStore';
import { findLastRealUserIndex, makeTailMessage, toEpoch } from '../injection/lastUserInjection';
import type { Message, PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    topicReferenceCount?: number;
    topicReferenceInjected?: boolean;
    topicReferenceInjectionCreatedAt?: number;
    /** T-202 P2: source-derived tail-slot identity (no Date.now()/random). */
    topicReferenceInjectionId?: string;
  }
}

const log = debug('context-engine:provider:TopicReferenceContextInjector');

/**
 * Topic reference item
 */
export interface TopicReferenceItem {
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
  /** T-202 / C7 (M2): interface symmetry only, UNUSED — pure derivation, no store write. */
  snapshotStore?: InjectionSnapshotStore;
  topicId?: string;
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
 * this injector appends the referenced topics' context to the last user message.
 * - Topics with summaries: summary is inlined directly
 * - Topics without summaries: a hint is added prompting the agent to read them via `lh topic view`
 */
export class TopicReferenceContextInjector extends BaseLastUserContentProvider {
  readonly name = 'TopicReferenceContextInjector';

  constructor(
    private config: TopicReferenceContextInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    log('doProcess called');
    log('config.enabled:', this.config.enabled);

    const clonedContext = this.cloneContext(context);

    if (
      !this.config.enabled ||
      !this.config.topicReferences ||
      this.config.topicReferences.length === 0
    ) {
      log('Topic reference not enabled or no references, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    const formattedContent = formatTopicReferences(this.config.topicReferences);

    if (!formattedContent) {
      log('No topic reference content to inject');
      return this.markAsExecuted(clonedContext);
    }

    log('Formatted content length:', formattedContent.length);

    const lastUserIndex = findLastRealUserIndex(clonedContext.messages);

    log('Last real user message index:', lastUserIndex);

    if (lastUserIndex === -1) {
      log('No user messages found, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    // T-202 批 B 剩余 / C7: project into a deterministic virtual tail slot.
    // P5: ORIGINAL wrapper-branch template kept verbatim (byte-for-byte the
    // pre-change branch expressions); only PLACEMENT changed.
    const hasExistingWrapper = this.hasExistingSystemContext(clonedContext);
    const contentToAppend = hasExistingWrapper
      ? this.createContextBlock(formattedContent, 'topic_reference_context')
      : this.wrapWithSystemContext(formattedContent, 'topic_reference_context');

    // Source-derived identity: fingerprint of immutable refer_topic ids → id.
    const fingerprint = Md5.hashStr(
      this.config
        .topicReferences!.map((r) => r.topicId)
        .sort()
        .join('|'),
    );
    const injectionId = `inject:lastUser:topicReference:${fingerprint}`;
    const carrierCreatedAt = toEpoch((clonedContext.messages[lastUserIndex] as Message).createdAt);

    const tailMessage = makeTailMessage({
      content: contentToAppend,
      createdAt: carrierCreatedAt,
      id: injectionId,
      injectType: 'topic-reference',
    });
    clonedContext.messages.push(tailMessage);

    // T-202 / C7 is M2 pure derivation: it writes NOTHING to any store. Tail-slot
    // bytes come solely from the immutable refer_topic message tags; no store write.

    clonedContext.metadata.topicReferenceInjectionId = injectionId;
    clonedContext.metadata.topicReferenceInjectionCreatedAt = carrierCreatedAt;
    clonedContext.metadata.topicReferenceInjected = true;
    clonedContext.metadata.topicReferenceCount = this.config.topicReferences.length;

    log('Topic reference context projected to tail slot');

    return this.markAsExecuted(clonedContext);
  }
}
