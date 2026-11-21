import debug from 'debug';

import { BaseLastUserContentProvider } from '../base/BaseLastUserContentProvider';
import {
  type InjectionSnapshotStore,
  lastUserTaskMgrKey,
} from '../injection/InjectionSnapshotStore';
import {
  appendSegmentToRealUser,
  findLastRealUserIndex,
  toEpoch,
} from '../injection/lastUserInjection';
import type { Message, PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    taskManagerContextInjected?: boolean;
    taskManagerContextInjectionCreatedAt?: number;
    /** T-202 P2: source-derived identity of the C6 segment (no Date.now()/random). */
    taskManagerContextInjectionId?: string;
  }
}

const log = debug('context-engine:provider:TaskManagerContextInjector');

export interface TaskManagerContextInjectorConfig {
  contextPrompt?: string;
  enabled?: boolean;
  /**
   * T-202 批 B 剩余 / C6 (M1): session-scoped snapshot store. The first matching
   * request writes `topicId:lastUser:taskMgr`; later operations reuse it.
   */
  snapshotStore?: InjectionSnapshotStore;
  topicId?: string;
}

/**
 * Appends Task Manager page context (list or detail) to the last REAL user message.
 *
 * T-202 批 B 剩余 / C6: M1 solidification + §2.7.1 P-branch segment order 3.
 * Trigger condition and SYSTEM_CONTEXT wrapper/template are verbatim (P5).
 */
export class TaskManagerContextInjector extends BaseLastUserContentProvider {
  readonly name = 'TaskManagerContextInjector';

  constructor(
    private config: TaskManagerContextInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    log('doProcess: enabled=%s hasPrompt=%s', this.config.enabled, !!this.config.contextPrompt);

    const clonedContext = this.cloneContext(context);

    // Original trigger expression, verbatim (P5).
    if (!this.config.enabled || !this.config.contextPrompt) {
      log('No Task Manager context, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    // M1: capture once, reuse verbatim across operations.
    const { snapshotStore, topicId } = this.config;
    if (snapshotStore && topicId) {
      const key = lastUserTaskMgrKey(topicId);
      const stored = snapshotStore.get<string>(key);
      if (stored !== undefined) {
        // Write the solidified bytes back onto the same config field the
        // original template reads, so the template below stays byte-identical.
        this.config.contextPrompt = stored;
      } else {
        snapshotStore.set(key, this.config.contextPrompt);
      }
    }

    const lastUserIndex = findLastRealUserIndex(clonedContext.messages);

    log('Last real user message index:', lastUserIndex);

    if (lastUserIndex === -1) {
      log('No user messages found, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    // P5: original wrapper-branch template kept verbatim (byte-for-byte the
    // pre-change expressions); only placement changed to u.content byte end.
    const hasExistingWrapper = this.hasExistingSystemContext(clonedContext);
    const contentToAppend = hasExistingWrapper
      ? this.createContextBlock(this.config.contextPrompt, 'task_manager_context')
      : this.wrapWithSystemContext(this.config.contextPrompt, 'task_manager_context');

    const realUser = clonedContext.messages[lastUserIndex];
    appendSegmentToRealUser(clonedContext, lastUserIndex, contentToAppend);

    // Source-derived identity (M1 key + real user createdAt), no now()/random.
    const injectionId = `inject:lastUser:taskMgr:${topicId ?? 'legacy'}`;
    clonedContext.metadata.taskManagerContextInjectionId = injectionId;
    clonedContext.metadata.taskManagerContextInjectionCreatedAt = toEpoch(
      (realUser as Message).createdAt,
    );

    clonedContext.metadata.taskManagerContextInjected = true;

    log('Task Manager context appended to last real user content byte end');

    return this.markAsExecuted(clonedContext);
  }
}
