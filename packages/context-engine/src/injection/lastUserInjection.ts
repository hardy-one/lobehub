/**
 * T-202 批 B 剩余 · shared deterministic helpers for the six
 * `BaseLastUserContentProvider` injection points (C1/C2/C4/C6/C7/C8).
 *
 * These mirror the already-migrated C3/C5 helpers (T-195) so that every
 * Last-User point uses the exact same anchor / tail / identity semantics:
 *  - P-branch (C1/C6): append a single SYSTEM_CONTEXT segment at the byte end
 *    of the last REAL user's content (T-193 §2.7.1).
 *  - T-branch (C2/C4/C7/C8): project into a deterministic virtual tail slot,
 *    leaving the real user untouched, so [0,k) stays byte-stable.
 *
 * Everything here is a pure function of immutable message state — no wall
 * clock, no random id (T-193 §1.4 P2).
 */
import type { Message, PipelineContext } from '../types';

/** Deterministic epoch from an unknown createdAt value (never wall clock). */
export const toEpoch = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const t = Date.parse(value);
    if (Number.isFinite(t)) return t;
  }
  return 0;
};

/**
 * §2.7.1 anchor u: last real user = role 'user' without injection markers.
 * Excludes T-slot virtual users and synthetic carriers so every Last-User
 * injector resolves the SAME real user regardless of how many tails were pushed.
 */
export const findLastRealUserIndex = (messages: PipelineContext['messages']): number => {
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
 * seg() pure function (§2.7.1): append one SYSTEM_CONTEXT-wrapped segment at
 * the BYTE END of u.content. The original content is never rewritten or
 * reordered — it stays a verbatim prefix substring (P4). Never merges into an
 * existing wrapper: each P-branch point owns its own single-segment wrapper.
 */
export const appendSegmentToRealUser = (
  context: PipelineContext,
  index: number,
  block: string,
): void => {
  const message = context.messages[index];
  const uContent = message.content;
  let nextContent: string | any[];

  if (typeof uContent === 'string') {
    nextContent = `${uContent}\n\n${block}`;
  } else if (Array.isArray(uContent)) {
    // Strict byte-end of the WHOLE content: add a NEW text part after ALL
    // existing parts (including trailing image/audio parts).
    nextContent = [...uContent, { text: block, type: 'text' }];
  } else {
    nextContent = block;
  }

  context.messages[index] = { ...message, content: nextContent } as Message;
};

export interface TailMessageInput {
  content: string;
  createdAt: number;
  id: string;
  injectType: string;
}

/** Build a deterministic virtual-tail user message (excluded from [0,k) prefix). */
export const makeTailMessage = (input: TailMessageInput): Message => ({
  content: input.content,
  createdAt: input.createdAt,
  id: input.id,
  meta: { injectType: input.injectType, virtualLastUser: true },
  role: 'user' as const,
  updatedAt: input.createdAt,
});
