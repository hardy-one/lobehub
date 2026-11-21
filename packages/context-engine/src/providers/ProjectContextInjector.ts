import debug from 'debug';

import { BaseLastUserContentProvider } from '../base/BaseLastUserContentProvider';
import {
  type InjectionSnapshotStore,
  lastUserProjectKey,
} from '../injection/InjectionSnapshotStore';
import type { Message, PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    projectContextInjected?: boolean;
    projectContextInjectionCreatedAt?: number;
    /** T-195 P2: source-derived identity of the C5 segment (no Date.now()/random). */
    projectContextInjectionId?: string;
  }
}

const log = debug('context-engine:provider:ProjectContextInjector');

export interface ProjectContextInjectorConfig {
  contextPrompt?: string;
  enabled?: boolean;
  /**
   * T-195 批 B / C5 (M1): session-scoped snapshot store. The first matching
   * request writes `topicId:lastUser:project` and later operations reuse it.
   */
  snapshotStore?: InjectionSnapshotStore;
  topicId?: string;
}

/** Deterministic epoch from an unknown createdAt value (never wall clock). */
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
 * T-193 §2.7.1 anchor u: last real user = role 'user' without injection markers
 * (excludes T-slot virtual users and synthetic carriers). Implemented locally so
 * the shared base is untouched (scope: only C3/C5).
 */
const findLastRealUserIndex = (messages: PipelineContext['messages']): number => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    const meta: any = (m as any).meta;
    if (meta?.systemInjection || meta?.injectType || meta?.virtualLastUser || meta?.steer) continue;
    return i;
  }
  return -1;
};

/**
 * seg() pure function (T-193 §2.7.1): append one SYSTEM_CONTEXT-wrapped segment
 * at the BYTE END of u.content (offset = byteLength(u.content) before append).
 * The original u.content is never rewritten or reordered — it stays a verbatim
 * prefix substring of the result (P4). Never inserts into an existing wrapper.
 */
const seg = (uContent: string | any[], block: string): string | any[] => {
  if (typeof uContent === 'string') {
    return `${uContent}\n\n${block}`;
  }

  if (Array.isArray(uContent)) {
    // Strict byte-end of the WHOLE content: append a NEW text part after ALL
    // existing parts. Never rewrite the last text part — if a trailing image /
    // audio part follows it, rewriting would leave the injection at the wrong
    // anchor. Every original part stays byte-for-byte and in order (P4).
    return [...uContent, { text: block, type: 'text' }];
  }

  return block;
};

/**
 * Append the C5 segment to the real user u at the exact byte-end anchor.
 * §2.7.1 forbids merging into an existing SYSTEM_CONTEXT wrapper; each P-branch
 * point owns one single-segment wrapper appended after u.content.
 */
const appendToRealUser = (context: PipelineContext, index: number, block: string): void => {
  const message = context.messages[index];
  context.messages[index] = { ...message, content: seg(message.content, block) };
};

/**
 * Appends the live context of the project a run belongs to (members, linked
 * knowledge, open tasks) to the last real user message.
 *
 * T-195 批 B / C5: M1 solidification. The first matching request captures
 * `contextPrompt` into `topicId:lastUser:project`; subsequent operations reuse
 * that exact value, so the segment appended at u.content byte end is stable.
 * Trigger condition, SYSTEM_CONTEXT wrapper and text template are verbatim (P5).
 */
export class ProjectContextInjector extends BaseLastUserContentProvider {
  readonly name = 'ProjectContextInjector';

  constructor(
    private config: ProjectContextInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    log('doProcess: enabled=%s hasPrompt=%s', this.config.enabled, !!this.config.contextPrompt);

    const clonedContext = this.cloneContext(context);

    // Original trigger expression, verbatim (P5).
    if (!this.config.enabled || !this.config.contextPrompt) {
      log('No project context, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    const { snapshotStore, topicId } = this.config;
    let solidPrompt = this.config.contextPrompt;

    if (snapshotStore && topicId) {
      const key = lastUserProjectKey(topicId);
      const stored = snapshotStore.get<string>(key);
      if (stored !== undefined) {
        solidPrompt = stored; // cross-operation reuse: exact bytes
      } else {
        snapshotStore.set(key, this.config.contextPrompt); // first matching request
      }
    }

    const lastUserIndex = findLastRealUserIndex(clonedContext.messages);

    log('Last real user message index:', lastUserIndex);

    if (lastUserIndex === -1) {
      log('No user messages found, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    // §2.7.1: one single-segment SYSTEM_CONTEXT wrapper, appended verbatim at
    // u.content byte end. The segment is never merged into any pre-existing wrapper.
    const realUser = clonedContext.messages[lastUserIndex];
    const contentToAppend = this.wrapWithSystemContext(solidPrompt, 'project_context');

    appendToRealUser(clonedContext, lastUserIndex, contentToAppend);

    // Source-derived identity (M1 key + real user createdAt), no now()/random.
    const injectionId = `inject:lastUser:project:${topicId ?? 'legacy'}`;
    const carrierCreatedAt = toEpoch((realUser as Message).createdAt);
    clonedContext.metadata.projectContextInjectionId = injectionId;
    clonedContext.metadata.projectContextInjectionCreatedAt = carrierCreatedAt;

    clonedContext.metadata.projectContextInjected = true;

    log('Project context appended to last real user content byte end');

    return this.markAsExecuted(clonedContext);
  }
}
