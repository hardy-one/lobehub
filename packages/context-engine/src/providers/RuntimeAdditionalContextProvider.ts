import { escapeXmlAttr, escapeXmlContent } from '@lobechat/prompts';
import type { RuntimeAdditionalContextFragment } from '@lobechat/types';
import { Md5 } from 'ts-md5';

import { BaseProcessor } from '../base/BaseProcessor';
import {
  type InjectionSnapshotStore,
  stablePrefixAdditionalContextKey,
  tailAdditionalContextKey,
} from '../injection/InjectionSnapshotStore';
import type { PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    /** T-204 P2: deterministic injection identities for the two placements. */
    runtimeAdditionalContextIds?: { stablePrefix?: string; virtualTail?: string };
  }
}

export interface RuntimeAdditionalContextProviderConfig {
  additionalContexts?: readonly RuntimeAdditionalContextFragment[];
  /** T-204 批D M1: session-scoped snapshot store + topic id. */
  snapshotStore?: InjectionSnapshotStore;
  topicId?: string;
}

/** A rendered placement block solidified once per session (no wall clock). */
interface AdditionalContextSnapshot {
  content: string;
  fingerprint: string;
}

export class RuntimeAdditionalContextProvider extends BaseProcessor {
  readonly name = 'RuntimeAdditionalContextProvider';

  constructor(
    private config: RuntimeAdditionalContextProviderConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  /**
   * T-204: solidify a rendered block to the session store and project the stored
   * bytes. Fingerprint is derived purely from the rendered text (immutable source),
   * with no wall-clock time or randomness. Returns the projected content + its deterministic id.
   */
  private solidify(
    rendered: string,
    key: (topicId: string) => string,
  ): { content: string; id: string } {
    const { snapshotStore, topicId } = this.config;
    if (snapshotStore && topicId) {
      const storeKey = key(topicId);
      const stored = snapshotStore.get<AdditionalContextSnapshot>(storeKey);
      if (stored) {
        return {
          content: stored.content,
          id: `inject:additionalContext:${this.name}:${stored.fingerprint}`,
        };
      }
      const fingerprint = Md5.hashStr(rendered);
      snapshotStore.set(storeKey, { content: rendered, fingerprint } as AdditionalContextSnapshot);
      return {
        content: rendered,
        id: `inject:additionalContext:${this.name}:${fingerprint}`,
      };
    }
    // Legacy path (no store): preserve pre-change behaviour for standalone callers.
    return {
      content: rendered,
      id: `inject:additionalContext:${this.name}:${Md5.hashStr(rendered)}`,
    };
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const fragments = this.config.additionalContexts;
    if (!fragments?.length) return this.markAsExecuted(context);

    const render = (placement: RuntimeAdditionalContextFragment['placement']) =>
      fragments
        .filter((fragment) => fragment.placement === placement)
        .map((fragment) => {
          const attributes = Object.entries(fragment.wrapper.attributes ?? {})
            .map(([key, value]) => ` ${key}="${escapeXmlAttr(value)}"`)
            .join('');
          const content =
            fragment.content.type === 'text'
              ? escapeXmlContent(fragment.content.text)
              : fragment.content.sections
                  .map((section) => {
                    const value =
                      section.format === 'text'
                        ? escapeXmlContent(String(section.value))
                        : JSON.stringify(
                            section.value,
                            null,
                            section.format === 'compact_json' ? undefined : 2,
                          )
                            .replaceAll('<', '\\u003c')
                            .replaceAll('>', '\\u003e');

                    return [`<${section.tag}>`, value, `</${section.tag}>`].join(
                      section.format === 'text' ? '' : '\n',
                    );
                  })
                  .join('\n');

          return [
            `<${fragment.wrapper.tag}${attributes}>`,
            content,
            `</${fragment.wrapper.tag}>`,
          ].join('\n');
        })
        .join('\n\n');

    let stableContent: string | undefined = render('stable_prefix');
    let tailContent: string | undefined = render('virtual_tail');
    if (!stableContent && !tailContent) return this.markAsExecuted(context);

    // Solidify both placements across operations; placement semantics unchanged.
    const stable = stableContent
      ? this.solidify(stableContent, stablePrefixAdditionalContextKey)
      : undefined;
    const tail = tailContent ? this.solidify(tailContent, tailAdditionalContextKey) : undefined;

    // P5: keep the baseline template slots and their parameter identifiers
    // byte-identical; only the value source (session snapshot) changes.
    stableContent = stable?.content;
    tailContent = tail?.content;

    const clonedContext = this.cloneContext(context);

    if (stableContent) {
      const injectionIndex = clonedContext.messages.findIndex(
        (message) => message.meta?.systemInjection === true,
      );

      if (injectionIndex === -1) {
        const firstUserIndex = clonedContext.messages.findIndex(
          (message) =>
            message.role === 'user' &&
            message.meta?.systemInjection !== true &&
            message.meta?.virtualLastUser !== true,
        );

        if (firstUserIndex !== -1) {
          // P form: identity derived from the solidified content fingerprint,
          // createdAt from the first real user's createdAt (never wall clock).
          const firstUser = clonedContext.messages[firstUserIndex];
          const createdAt =
            typeof firstUser.createdAt === 'number'
              ? firstUser.createdAt
              : firstUser.createdAt instanceof Date
                ? firstUser.createdAt.getTime()
                : 0;
          clonedContext.messages.splice(firstUserIndex, 0, {
            content: stableContent,
            createdAt,
            id: stable!.id,
            meta: { systemInjection: true },
            role: 'user',
            updatedAt: createdAt,
          });
        }
      } else {
        const message = clonedContext.messages[injectionIndex];

        clonedContext.messages[injectionIndex] = {
          ...message,
          content:
            typeof message.content === 'string'
              ? `${stableContent}\n\n${message.content}`
              : [{ text: stableContent, type: 'text' }, ...message.content],
        };
      }
    }

    if (tailContent) {
      const lastIndex = clonedContext.messages.length - 1;
      const lastMessage = clonedContext.messages[lastIndex];

      if (lastMessage?.role === 'user' && lastMessage.meta?.virtualLastUser === true) {
        clonedContext.messages[lastIndex] = {
          ...lastMessage,
          content:
            typeof lastMessage.content === 'string'
              ? `${lastMessage.content}\n\n${tailContent}`
              : [...lastMessage.content, { text: tailContent, type: 'text' }],
        };
      } else {
        // T form: identity derived from the solidified content fingerprint,
        // createdAt from the last real user's createdAt (never wall clock).
        const lastRealUser = [...clonedContext.messages]
          .reverse()
          .find(
            (message) =>
              message.role === 'user' &&
              message.meta?.virtualLastUser !== true &&
              message.meta?.systemInjection !== true,
          );
        const createdAt =
          typeof lastRealUser?.createdAt === 'number'
            ? lastRealUser.createdAt
            : lastRealUser?.createdAt instanceof Date
              ? lastRealUser.createdAt.getTime()
              : 0;
        clonedContext.messages.push({
          content: tailContent,
          createdAt,
          id: tail!.id,
          meta: { injectType: this.name, virtualLastUser: true },
          role: 'user',
          updatedAt: createdAt,
        });
      }
    }

    clonedContext.metadata.runtimeAdditionalContextIds = {
      ...(stable ? { stablePrefix: stable.id } : {}),
      ...(tail ? { virtualTail: tail.id } : {}),
    };

    return this.markAsExecuted(clonedContext);
  }
}
