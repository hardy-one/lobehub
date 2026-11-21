import { Md5 } from 'ts-md5';

import type { InjectionSnapshotStore } from '../injection/InjectionSnapshotStore';
import type { Message, PipelineContext, ProcessorOptions } from '../types';
import { BaseProcessor } from './BaseProcessor';

declare module '../types' {
  interface ProcessorOptions {
    /**
     * T-201: session-scoped M1 snapshot config for a first-user merged-block
     * injector. When present, the built content is written once per topic and
     * reused byte-identically on every later operation. Trigger conditions and
     * injection text templates are untouched (T-193 P5).
     */
    firstUserSnapshot?: {
      /** Full key suffix, e.g. `firstUser:userMemory`. */
      keySuffix: string;
      store: InjectionSnapshotStore;
      topicId: string;
    };
  }

  interface PipelineContextMetadataOverrides {
    /** Deterministic carrier identity recorded before MessageCleanup strips meta (P2). */
    firstUserInjectionCreatedAt?: number;
    firstUserInjectionId?: string;
  }
}

export interface FirstUserSnapshotOptions {
  /** Full key suffix, e.g. `firstUser:userMemory`. */
  keySuffix: string;
  store: InjectionSnapshotStore;
  topicId: string;
}

/**
 * Marker to identify system injection messages
 */
const SYSTEM_INJECTION_MARKER = 'systemInjection';

/** Source-derived timestamp: never wall-clock time (T-193 P2). */
const toEpoch = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const t = Date.parse(value);
    if (Number.isFinite(t)) return t;
  }
  return 0;
};

/**
 * Base Provider for prepending content before the first user message
 * Used for injecting static context like knowledge and user memories
 *
 * Features:
 * - First provider creates a new user message before the first user message
 * - Subsequent providers append to the existing system injection message
 * - All injected content is consolidated into a single message
 *
 * T-201: when `firstUserSnapshot` is supplied (M1), the rendered content is
 * solidified into a session-scoped store on the first matching request and
 * reused byte-identically on every later operation, and the carrier identity
 * is derived from the source (content hash + first real user createdAt) rather
 * than a wall-clock timestamp. Without it, the legacy behaviour is preserved.
 */
export abstract class BaseFirstUserContentProvider extends BaseProcessor {
  /** createdAt of the first real user turn — deterministic carrier identity (P2). */
  protected firstUserCarrierCreatedAt = 0;
  /** T-201 M1 snapshot config supplied by MessagesEngine. */
  protected firstUserSnapshot?: FirstUserSnapshotOptions;

  constructor(options: ProcessorOptions = {}) {
    super(options);
    this.firstUserSnapshot = options.firstUserSnapshot;
  }

  /**
   * Build the content to inject
   * Subclasses must implement this method
   * @returns The content string to inject, or null to skip injection
   */
  protected abstract buildContent(context: PipelineContext): string | null;

  /**
   * Find the index of the first user message
   */
  protected findFirstUserMessageIndex(messages: Message[]): number {
    return messages.findIndex((msg) => msg.role === 'user');
  }

  /**
   * Find the existing system injection message (if any)
   */
  protected findSystemInjectionMessage(messages: Message[]): Message | undefined {
    return messages.find((msg) => msg.meta?.[SYSTEM_INJECTION_MARKER] === true);
  }

  /**
   * Find the index of the existing system injection message
   */
  protected findSystemInjectionMessageIndex(messages: Message[]): number {
    return messages.findIndex((msg) => msg.meta?.[SYSTEM_INJECTION_MARKER] === true);
  }

  /**
   * Create a new system injection message.
   *
   * M1 path: id is derived from the key suffix + content hash and createdAt
   * from the first real user turn — no wall-clock time or random id in this path.
   * Legacy path (no snapshot config): byte-identical to the pre-change version.
   */
  protected createSystemInjectionMessage(content: string): Message {
    if (this.firstUserSnapshot) {
      const contentHash = Md5.hashStr(content);
      return {
        content,
        createdAt: this.firstUserCarrierCreatedAt,
        id: `inject:${this.firstUserSnapshot.keySuffix}:${contentHash}`,
        meta: { [SYSTEM_INJECTION_MARKER]: true },
        role: 'user' as const,
        updatedAt: this.firstUserCarrierCreatedAt,
      };
    }

    // Legacy path (no snapshot config): keep the `system-injection-` id prefix
    // and content/role/meta template, but derive every time/id field from the
    // source instead of the wall clock — no wall-clock calls anywhere in this class.
    const legacyHash = Md5.hashStr(content);
    return {
      content,
      createdAt: this.firstUserCarrierCreatedAt,
      id: `system-injection-${legacyHash}`,
      meta: { [SYSTEM_INJECTION_MARKER]: true },
      role: 'user' as const,
      updatedAt: this.firstUserCarrierCreatedAt,
    };
  }

  /**
   * Append content to an existing message
   */
  protected appendToMessage(message: Message, contentToAppend: string): Message {
    const currentContent = message.content;

    if (typeof currentContent === 'string') {
      return {
        ...message,
        content: currentContent + '\n\n' + contentToAppend,
      };
    }

    // Handle array content (multimodal messages) - find last text part and append
    if (Array.isArray(currentContent)) {
      const lastTextIndex = currentContent.findLastIndex((part: any) => part.type === 'text');

      if (lastTextIndex !== -1) {
        const newContent = [...currentContent];
        newContent[lastTextIndex] = {
          ...newContent[lastTextIndex],
          text: newContent[lastTextIndex].text + '\n\n' + contentToAppend,
        };
        return {
          ...message,
          content: newContent,
        };
      }

      // No text part found, add a new one
      return {
        ...message,
        content: [...currentContent, { text: contentToAppend, type: 'text' }],
      };
    }

    return message;
  }

  /**
   * Process the context by injecting content before the first user message
   * If a system injection message already exists, append to it instead.
   *
   * T-201 M1: when a snapshot config is present, the trigger (`buildContent`)
   * is still evaluated verbatim; only the *source* of the already-built bytes
   * may be swapped for the solidified snapshot, so get an identical payload on
   * every operation of the same session (T-193 §2.7, key `<topicId>:<suffix>`).
   */
  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const snap = this.firstUserSnapshot;

    // Deterministic carrier timestamp from the first real user turn for both
    // the M1 and legacy paths — never wall-clock time.
    const firstUser = context.messages.find((msg) => msg.role === 'user');
    this.firstUserCarrierCreatedAt = toEpoch(firstUser?.createdAt);

    // M1 跨 operation 持久化（T-193 §2.7 / 验收判据）：一旦某点在本会话首次
    // 固化了快照，后续每个 operation 都必须复用它——即使本次的触发条件已不再
    // 满足。因此先读快照：命中则直接投影，不调用 buildContent；未命中才逐字求值
    // 原触发条件，非空则写入。这样「触发关闭 → 注入消失」的反例被排除，注入块
    // 在 user[0] 前的合并块中持续存在，前缀字节保持稳定。
    let content: string | null = null;

    if (snap) {
      const key = `${snap.topicId}:${snap.keySuffix}`;
      const stored = snap.store.get<string>(key);
      if (stored !== undefined) {
        // Cross-operation reuse regardless of this operation's trigger state.
        content = stored;
      } else {
        // No solidified value yet: original trigger expression, verbatim (P5).
        content = this.buildContent(context);
        if (content) {
          // First matching request: collect once, write to the session store.
          snap.store.set(key, content);
        }
      }
    } else {
      // Legacy path (no snapshot config): original trigger expression, verbatim (P5).
      content = this.buildContent(context);
    }

    if (!content) {
      return this.markAsExecuted(context);
    }

    const clonedContext = this.cloneContext(context);
    const existingIndex = this.findSystemInjectionMessageIndex(clonedContext.messages);

    if (existingIndex !== -1) {
      // Append to existing system injection message
      clonedContext.messages[existingIndex] = this.appendToMessage(
        clonedContext.messages[existingIndex],
        content,
      );
    } else {
      // Create new system injection message before first user message
      const firstUserIndex = this.findFirstUserMessageIndex(clonedContext.messages);

      if (firstUserIndex === -1) {
        // No user messages found, skip injection
        return this.markAsExecuted(clonedContext);
      }

      const injectionMessage = this.createSystemInjectionMessage(content);
      clonedContext.messages.splice(firstUserIndex, 0, injectionMessage);
    }

    // Record the deterministic carrier identity before MessageCleanup strips
    // `meta`, so P2 stays provable on the final payload (T-194 shared harness).
    if (snap) {
      const carrier = clonedContext.messages.find(
        (msg) => msg.meta?.[SYSTEM_INJECTION_MARKER] === true,
      );
      if (carrier) {
        clonedContext.metadata.firstUserInjectionId = carrier.id;
        clonedContext.metadata.firstUserInjectionCreatedAt = carrier.createdAt;
      }
    }

    return this.markAsExecuted(clonedContext);
  }
}
