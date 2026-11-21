import debug from 'debug';
import { Md5 } from 'ts-md5';

import { BaseVirtualLastUserContentProvider } from '../base/BaseVirtualLastUserContentProvider';
import { CONTEXT_INSTRUCTION, SYSTEM_CONTEXT_END, SYSTEM_CONTEXT_START } from '../base/constants';
import {
  type InjectionSnapshotStore,
  virtualTailTodosKey,
} from '../injection/InjectionSnapshotStore';
import type { Message, PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    todoCompletedCount?: number;
    todoCount?: number;
    todoInjected?: boolean;
    todoInjectionCreatedAt?: number;
    /** T-197 P2: source-derived virtual-tail identity (no Date.now()/random). */
    todoInjectionId?: string;
    todoProcessingCount?: number;
  }
}

const log = debug('context-engine:provider:TodoInjector');

/** Status of a todo item */
export type TodoStatus = 'todo' | 'processing' | 'completed';

/**
 * Todo item structure
 */
export interface TodoItem {
  /** Status of the todo item */
  status: TodoStatus;
  /** The todo item text */
  text: string;
}

/**
 * Todo list structure
 */
export interface TodoList {
  items: TodoItem[];
  updatedAt: string;
}

export interface TodoSnapshot {
  /** Source-derived fingerprint of the formatted todo content (no wall clock/random). */
  fingerprint: string;
  /** Todo source captured for this fingerprint. */
  todos: TodoList;
}

export interface TodoInjectorConfig {
  /** Whether Todo injection is enabled */
  enabled?: boolean;
  /**
   * T-197 批 D / E1 (M1): session-scoped injection snapshot store. Each
   * injecting operation fingerprints the current todos; matching fingerprints
   * reuse the stored snapshot, a changed todo list refreshes it. The
   * `injectTodos` throttle stays a per-operation functional control (its
   * trigger is verbatim, unchanged).
   */
  snapshotStore?: InjectionSnapshotStore;
  /** The current todo list to inject */
  todos?: TodoList;
  topicId?: string;
}

/**
 * Format Todo list content for injection
 */
function formatTodos(todos: TodoList): string | null {
  const { items } = todos;

  if (!items || items.length === 0) {
    return null;
  }

  const lines: string[] = ['<todos>'];

  items.forEach((item, index) => {
    lines.push(`<todo index="${index}" status="${item.status}">${item.text}</todo>`);
  });

  const completedCount = items.filter((item) => item.status === 'completed').length;
  const processingCount = items.filter((item) => item.status === 'processing').length;
  const totalCount = items.length;
  lines.push(
    `<progress completed="${completedCount}" processing="${processingCount}" total="${totalCount}" />`,
  );

  lines.push('</todos>');

  return lines.join('\n');
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
 * Todo Injector
 * Responsible for injecting the current todo list as a standalone virtual tail message
 * This provides the AI with real-time awareness of task progress
 *
 * T-197 批 D / E1: the todos snapshot is stored in the session-scoped M1 store
 * (`topicId:virtualTail:todos`) and projected into the deterministic virtual
 * tail slot. Same-source operations reuse the stored bytes; a source change
 * refreshes the snapshot so the model always sees the current todos. The
 * `injectTodos` throttle (stepIndex%10===0, upstream) is a functional control
 * and is preserved verbatim.
 */
export class TodoInjector extends BaseVirtualLastUserContentProvider {
  readonly name = 'TodoInjector';

  /** createdAt of the last real user turn — deterministic carrier identity (P2). */
  private carrierCreatedAt = 0;

  /** Source-derived fingerprint of the todos resolved for this operation. */
  private todosFingerprint = '';

  constructor(
    private config: TodoInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected shouldSkip(context: PipelineContext): boolean {
    if (!this.config.enabled || !this.config.todos) {
      log('Todo not enabled or no todos, skipping injection');
      return true;
    }

    const hasRealUser = context.messages.some(
      (message) =>
        message.role === 'user' &&
        message.meta?.virtualLastUser !== true &&
        message.meta?.systemInjection !== true,
    );
    if (!hasRealUser) {
      log('No user messages found, skipping injection');
      return true;
    }

    return false;
  }

  protected buildContent(_context: PipelineContext): string | null {
    const formattedContent = formatTodos(this.config.todos!);

    if (!formattedContent) {
      log('No todos to inject (empty list)');
      return null;
    }

    log('Formatted content length:', formattedContent.length);

    return `${SYSTEM_CONTEXT_START}
${CONTEXT_INSTRUCTION}
<todo_context>
${formattedContent}
</todo_context>
${SYSTEM_CONTEXT_END}`;
  }

  /**
   * P2: deterministic virtual-tail identity derived from the session topicId and
   * the last real user's createdAt — no wall-clock time or random id anywhere in
   * this injection path. The injected CONTENT text, role and `virtualLastUser`
   * marker stay byte-identical to the base template (T-193 P5 only exempts
   * id/createdAt/updatedAt).
   */
  protected createVirtualLastUserMessage(content: string): Message {
    const { topicId } = this.config;
    return {
      content,
      createdAt: this.carrierCreatedAt,
      id: `inject:virtualTail:todos:${topicId ?? 'legacy'}:${this.todosFingerprint}`,
      meta: this.createVirtualLastUserMeta(),
      role: 'user' as const,
      updatedAt: this.carrierCreatedAt,
    };
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    if (this.shouldSkip(context)) {
      return this.markAsExecuted(context);
    }

    // ---- T-197 M1 snapshot: fingerprint the current todos. Matching fingerprints
    // reuse the stored source (byte-stable projection); a changed list refreshes
    // the snapshot so the next operation never sees stale todos. The throttle
    // trigger above is untouched (functional behaviour preserved). ----
    const { snapshotStore, topicId } = this.config;
    if (snapshotStore && topicId && this.config.todos) {
      const key = virtualTailTodosKey(topicId);
      const sourceTodos = this.config.todos;
      const sourceFingerprint = Md5.hashStr(formatTodos(sourceTodos) ?? '');
      this.todosFingerprint = sourceFingerprint;
      const stored = snapshotStore.getIfFresh<TodoSnapshot>(key, sourceFingerprint);
      if (stored) {
        this.config = { ...this.config, todos: stored.todos };
      } else {
        snapshotStore.refresh(key, { fingerprint: sourceFingerprint, todos: sourceTodos });
      }
    } else if (this.config.todos) {
      this.todosFingerprint = Md5.hashStr(formatTodos(this.config.todos) ?? '');
    }

    const content = this.buildContent(context);
    if (!content) {
      return this.markAsExecuted(context);
    }

    // Deterministic carrier timestamp from the last real user turn, never now().
    const lastRealUser = [...context.messages]
      .reverse()
      .find(
        (message) =>
          message.role === 'user' &&
          message.meta?.virtualLastUser !== true &&
          message.meta?.systemInjection !== true,
      );
    this.carrierCreatedAt = toEpoch(lastRealUser?.createdAt);

    const clonedContext = this.cloneContext(context);
    clonedContext.messages.push(this.createVirtualLastUserMessage(content));

    const { items } = this.config.todos!;

    clonedContext.metadata.todoInjected = true;
    clonedContext.metadata.todoCount = items.length;
    clonedContext.metadata.todoCompletedCount = items.filter(
      (item) => item.status === 'completed',
    ).length;
    clonedContext.metadata.todoProcessingCount = items.filter(
      (item) => item.status === 'processing',
    ).length;

    // P2: expose the deterministic virtual-tail identity via metadata so it
    // remains provable after MessageCleanup strips `meta`.
    clonedContext.metadata.todoInjectionId = `inject:virtualTail:todos:${topicId ?? 'legacy'}:${this.todosFingerprint}`;
    clonedContext.metadata.todoInjectionCreatedAt = this.carrierCreatedAt;

    log('Todo context injected as virtual tail user message');

    return this.markAsExecuted(clonedContext);
  }
}
