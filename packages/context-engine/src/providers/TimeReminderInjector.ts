import { BaseProcessor } from '../base/BaseProcessor';
import type { Message, PipelineContext, ProcessorOptions } from '../types';

/** Default cadence, matching DSH/Codex: inject only when >= 10 min since the last injected turn. */
const DEFAULT_INTERVAL_MS = 10 * 60 * 1000;

export interface TimeReminderInjectorConfig {
  enabled?: boolean;
  intervalMs?: number;
  timezone?: string | null;
}

/**
 * Context-injection carriers are synthetic `role: user` messages (user memory,
 * expertise, ... — see BaseFirstUserContentProvider / BaseVirtualLastUserContentProvider).
 * They are stamped with `createdAt = Date.now()` and sit ahead of the real user
 * turns. Counting them in the cadence would anchor the first injection on a
 * synthetic "now", making every real turn look older than it is and collapsing
 * the whole history to a single reminder. Skip them.
 */
const isInjectionCarrier = (message: Message): boolean =>
  message.meta?.systemInjection === true ||
  message.meta?.virtualLastUser === true ||
  // AgentManagementContextInjector splices this delegation hint as a standalone
  // role:'user' message with createdAt=now, deliberately without systemInjection
  // (so it isn't merged by BaseFirstUserContentProvider). It is still synthetic —
  // skip it or its stamp would become a false cadence anchor and pollute the hint.
  message.meta?.injectType === 'agent-mention-delegation';

/**
 * `Message.createdAt` is an epoch-milliseconds number on the canonical path,
 * but DB rehydrates and tests carry ISO strings or Date objects. Normalize
 * explicitly — `Date.parse(number)` coerces to a garbage string and yields NaN.
 */
const toEpochMs = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : undefined;
  }
  return undefined;
};

/**
 * Prepend a block to a message body, before the user's own words. Self-contained
 * (no SYSTEM CONTEXT wrapper / context.instruction): a time snapshot is an
 * environment fact, not optional "context", and reads plainly at the head of
 * the turn. Handles string and multimodal content; for the latter it prepends
 * to the first text part, or inserts one at the front when there is none.
 */
const prependBlock = (message: Message, block: string): Message => {
  const current = message.content;
  if (typeof current === 'string') {
    return { ...message, content: `${block}\n\n${current}` };
  }
  if (Array.isArray(current)) {
    const firstTextIndex = current.findIndex((part: any) => part.type === 'text');
    if (firstTextIndex !== -1) {
      const next = [...current];
      next[firstTextIndex] = {
        ...next[firstTextIndex],
        text: `${block}\n\n${next[firstTextIndex].text}`,
      };
      return { ...message, content: next };
    }
    return { ...message, content: [{ text: block, type: 'text' }, ...current] };
  }
  return message;
};

/**
 * Injects a durable, absolute-time snapshot at the head of eligible user
 * messages so the model keeps a sense of "when" each turn happened and how far
 * apart turns are.
 *
 * The decision is deterministic and append-only: a message is injected iff it
 * is the first real user turn or at least `intervalMs` after the last injected
 * turn. It depends only on the message's own `createdAt` and earlier injected
 * turns — never on wall-clock time or on later messages. That makes the
 * processed prefix byte-identical as a conversation grows, which is what the
 * LLM prefix cache needs. The content itself is the absolute time of `createdAt`,
 * not a relative "N minutes ago" that would drift between requests.
 *
 * Deliberately does NOT use BaseEveryUserContentProvider: its wrapWithSystemContext
 * adds a SYSTEM CONTEXT wrapper + "only required when the query relies on it"
 * instruction and appends to the tail. We want a bare `<time_reminder>` block at
 * the head of the message instead.
 */
export class TimeReminderInjector extends BaseProcessor {
  readonly name = 'TimeReminderInjector';

  constructor(
    private config: TimeReminderInjectorConfig = {},
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    if (!this.config.enabled) return this.markAsExecuted(context);

    const interval = this.config.intervalMs ?? DEFAULT_INTERVAL_MS;
    const cloned = this.cloneContext(context);
    let lastInjectedAt: number | undefined;
    let injectCount = 0;

    for (let i = 0; i < cloned.messages.length; i++) {
      const message = cloned.messages[i];
      if (message.role !== 'user' || isInjectionCarrier(message)) continue;

      const t = toEpochMs(message.createdAt);
      if (t === undefined) continue;
      if (lastInjectedAt !== undefined && t - lastInjectedAt < interval) continue;

      const ts = this.formatTime(t);
      if (!ts) continue; // invalid timezone — skip this message, never abort the pipeline

      lastInjectedAt = t;
      cloned.messages[i] = prependBlock(
        message,
        `<time_reminder>\nIt is ${ts} (${this.config.timezone || 'UTC'}).\n</time_reminder>`,
      );
      injectCount++;
    }

    if (injectCount > 0) cloned.metadata[`${this.name}InjectedCount`] = injectCount;
    return this.markAsExecuted(cloned);
  }

  /** Format an epoch instant as `YYYY-MM-DD HH:MM:SS` in the configured zone, or null on bad zone. */
  private formatTime(t: number): string | null {
    const tz = this.config.timezone || 'UTC';
    try {
      // Assemble from parts rather than relying on a locale's default layout:
      // Intl's sv-SE shortcut can omit the day field on some Node versions.
      const parts = new Intl.DateTimeFormat('en-US', {
        day: '2-digit',
        hour: '2-digit',
        hourCycle: 'h23',
        minute: '2-digit',
        month: '2-digit',
        second: '2-digit',
        timeZone: tz,
        year: 'numeric',
      }).formatToParts(new Date(t));
      const get = (type: Intl.DateTimeFormatPartTypes) =>
        parts.find((p) => p.type === type)?.value ?? '';
      return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
    } catch {
      return null;
    }
  }
}
