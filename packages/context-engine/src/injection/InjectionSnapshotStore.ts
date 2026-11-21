/**
 * Session-scoped injection snapshot store (T-193 §1.3 mechanism M1).
 *
 * Key layout: `<topicId>:firstUser:expertise` (see `firstUserExpertiseKey`).
 * One instance is created per conversation/topic and shared across every
 * operation of that session, so a value written once by the original trigger
 * logic is projected byte-identically on all subsequent requests.
 *
 * This store holds prompt-injection snapshots only. It is deliberately
 * separate from the UI message store — nothing written here becomes a
 * visible chat message (T-193 §4.2).
 */
export const FIRST_USER_EXPERTISE_SUFFIX = 'firstUser:expertise';

export const firstUserExpertiseKey = (topicId: string): string =>
  `${topicId}:${FIRST_USER_EXPERTISE_SUFFIX}`;

/**
 * T-196 探针3 · D1 (Every-User 尾包裹) key layout.
 * One entry per persisted user message, so the wrapper solidified on the first
 * operation is reused byte-identically on every later operation of the session.
 */
export const EVERY_USER_CONTEXT_SELECTIONS_SUFFIX = 'everyUser:contextSelections';

export const everyUserContextSelectionsKey = (topicId: string, messageId: string): string =>
  `${topicId}:${EVERY_USER_CONTEXT_SELECTIONS_SUFFIX}:${messageId}`;

export interface ContextSelectionsSnapshot {
  /** Source-derived identity: no wall-clock time, no random component. */
  fingerprint: string;
  /** Solidified source selections (reused verbatim on every later operation). */
  selections: unknown[];
}

/**
 * T-195 批 B / C5 (ProjectContextInjector) M1 snapshot key.
 * C5 is a P-branch point anchored at the last real user u.content byte end
 * (T-193 §2.7.1, segment order 2). The solidified value is the contextPrompt
 * captured on the first matching request; later operations reuse it verbatim.
 */
export const LAST_USER_PROJECT_SUFFIX = 'lastUser:project';

export const lastUserProjectKey = (topicId: string): string =>
  `${topicId}:${LAST_USER_PROJECT_SUFFIX}`;

/**
 * T-195 批 B / C3 (SelectedSkillInjector) M2 projection audit key.
 * Unlike C5 (M1 solidification), C3 keeps its genuine per-operation churn and
 * confines it to the virtual tail slot. This key records the last projected
 * snapshot for audit; byte-stability of the [0,k) prefix comes from the tail
 * slot placement, not from reusing this value.
 */
export const LAST_USER_SELECTED_SKILLS_SUFFIX = 'lastUser:selectedSkills';

export const lastUserSelectedSkillsKey = (topicId: string): string =>
  `${topicId}:${LAST_USER_SELECTED_SKILLS_SUFFIX}`;

/**
 * T-197 批 D / E1 (TodoInjector) M1 snapshot key.
 * E1 is a virtual-tail point: high-churn todo content lives in the last slot so
 * the [0,k) prefix stays byte-stable. The snapshot is reused while the source
 * fingerprint matches and refreshed when the todo list changes, while the
 * `injectTodos` throttle (stepIndex%10===0) keeps its original per-operation
 * lifecycle.
 */
export const VIRTUAL_TAIL_TODOS_SUFFIX = 'virtualTail:todos';

export const virtualTailTodosKey = (topicId: string): string =>
  `${topicId}:${VIRTUAL_TAIL_TODOS_SUFFIX}`;

/**
 * T-202 批 B 剩余 · C1 (ActiveTopicDocumentContextInjector) M1 snapshot key.
 * C1 is a P-branch point anchored at the last real user u.content byte end
 * (T-193 §2.7.1, segment order 1). The solidified value is the formatted
 * active-topic-document block captured on the first matching request; later
 * operations reuse it verbatim.
 */
export const LAST_USER_ACTIVE_DOC_SUFFIX = 'lastUser:activeDoc';

export const lastUserActiveDocKey = (topicId: string): string =>
  `${topicId}:${LAST_USER_ACTIVE_DOC_SUFFIX}`;

/**
 * T-202 批 B 剩余 · C6 (TaskManagerContextInjector) M1 snapshot key.
 * C6 is a P-branch point anchored at the last real user u.content byte end
 * (T-193 §2.7.1, segment order 3). The solidified value is the page
 * `contextPrompt` captured on the first matching request.
 */
export const LAST_USER_TASK_MGR_SUFFIX = 'lastUser:taskMgr';

export const lastUserTaskMgrKey = (topicId: string): string =>
  `${topicId}:${LAST_USER_TASK_MGR_SUFFIX}`;

/**
 * T-202 批 B 剩余 · C2 (SkillImportRouteInjector) M2 projection audit key.
 * The skill links are derived from the already-persisted last-user message text,
 * so M2 holds (T-193 §5.4 not-applicable boundary is NOT triggered here).
 * Byte-stability of [0,k) comes from tail-slot placement, not from this value.
 */
export const LAST_USER_SKILL_IMPORT_ROUTE_SUFFIX = 'lastUser:skillImportRoute';

export const lastUserSkillImportRouteKey = (topicId: string): string =>
  `${topicId}:${LAST_USER_SKILL_IMPORT_ROUTE_SUFFIX}`;

/**
 * T-202 批 B 剩余 · C4 (SelectedToolInjector) M2 projection audit key.
 * Like C3, selected tools genuinely churn; the audit snapshot is not the reuse
 * source — stability of [0,k) comes from the deterministic tail slot.
 */
export const LAST_USER_SELECTED_TOOLS_SUFFIX = 'lastUser:selectedTools';

export const lastUserSelectedToolsKey = (topicId: string): string =>
  `${topicId}:${LAST_USER_SELECTED_TOOLS_SUFFIX}`;

/**
 * T-202 批 B 剩余 · C7 (TopicReferenceContextInjector) M2 projection audit key.
 * Derived from the immutable <refer_topic> tags carried by the user message.
 */
export const LAST_USER_TOPIC_REFERENCE_SUFFIX = 'lastUser:topicReference';

export const lastUserTopicReferenceKey = (topicId: string): string =>
  `${topicId}:${LAST_USER_TOPIC_REFERENCE_SUFFIX}`;

/**
 * T-202 批 B 剩余 · C8 (DocumentReferenceContextInjector) M2 projection audit key.
 * Derived from the immutable <refer_document> tags carried by the user message.
 */
export const LAST_USER_DOCUMENT_REFERENCE_SUFFIX = 'lastUser:documentReference';

export const lastUserDocumentReferenceKey = (topicId: string): string =>
  `${topicId}:${LAST_USER_DOCUMENT_REFERENCE_SUFFIX}`;

/**
 * T-204 批D剩余 · E2 (OnboardingActionHintInjector) M1 snapshot key.
 */
export const VIRTUAL_TAIL_ONBOARDING_HINT_SUFFIX = 'virtualTail:onboardingHint';

export const virtualTailOnboardingHintKey = (topicId: string): string =>
  `${topicId}:${VIRTUAL_TAIL_ONBOARDING_HINT_SUFFIX}`;

/**
 * T-204 批D剩余 · F3 (GoalContextSyntheticInjector) M1 snapshot key.
 */
export const TAIL_GOAL_CONTEXT_SUFFIX = 'tail:goalContext';

export const tailGoalContextKey = (topicId: string): string =>
  `${topicId}:${TAIL_GOAL_CONTEXT_SUFFIX}`;

/**
 * T-204 批D剩余 · F4 (OnboardingSyntheticStateInjector) M1 snapshot key.
 */
export const TAIL_ONBOARDING_STATE_SUFFIX = 'tail:onboardingState';

export const tailOnboardingStateKey = (topicId: string): string =>
  `${topicId}:${TAIL_ONBOARDING_STATE_SUFFIX}`;

/**
 * T-204 批D剩余 · F5 (RuntimeAdditionalContextProvider) M1 snapshot keys.
 */
export const STABLE_PREFIX_ADDITIONAL_CONTEXT_SUFFIX = 'stablePrefix:additionalContext';

export const stablePrefixAdditionalContextKey = (topicId: string): string =>
  `${topicId}:${STABLE_PREFIX_ADDITIONAL_CONTEXT_SUFFIX}`;

export const TAIL_ADDITIONAL_CONTEXT_SUFFIX = 'tail:additionalContext';

export const tailAdditionalContextKey = (topicId: string): string =>
  `${topicId}:${TAIL_ADDITIONAL_CONTEXT_SUFFIX}`;

/**
 * T-219 · 457 AgentDocumentMessageInjector (role:'system' standalone carriers)
 * M1 snapshot key. One carrier per `position`, keyed by the source document set:
 * `after-first-user` projects after the first real user, `context-end` at the
 * sequence end. `docKey` is the hash of the sorted contributing document ids, so
 * the key is derived from the source rather than the operation.
 */
export const AGENT_DOC_MESSAGE_SUFFIX = 'agentDoc:message';

export const agentDocMessageKey = (topicId: string, docKey: string, position: string): string =>
  `${topicId}:${AGENT_DOC_MESSAGE_SUFFIX}:${docKey}:${position}`;

/**
 * T-219 M1 position index for the same point.
 *
 * The carrier is solidified once per session (same persist-once rule as the
 * other M1 points in this batch): a later operation that no longer selects the
 * documents still projects the same bytes at the same fixed slot. Keeping the
 * index per `position` is what lets the replay find the snapshot without the
 * document list (`docKey` is normally derived from the documents themselves).
 */
export const AGENT_DOC_MESSAGE_INDEX_SUFFIX = 'agentDoc:message:index';

export const agentDocMessageIndexKey = (topicId: string): string =>
  `${topicId}:${AGENT_DOC_MESSAGE_INDEX_SUFFIX}`;

export interface AgentDocMessageIndexEntry {
  /** Source-derived timestamp of the solidified carrier. */
  createdAt: number;
  /** Identity of the document set that produced the solidified carrier. */
  docKey: string;
}

/**
 * T-218 B1 (AgentManagementContextInjector second injection point,
 * `<mentioned_agents>` delegation hint) M1 snapshot key.
 *
 * B1 is a virtual-tail point (T-193 §2.7 B1): the delegation hint is projected
 * into the last message slot and only when `mentionedAgents` is non-empty. The
 * snapshot lets consecutive operations that carry the same mentioned-agent set
 * reuse the exact same bytes; a different set re-projects (fingerprint check)
 * so the delegation semantics never freeze on a stale set.
 */
export const MENTIONED_AGENTS_SUFFIX = 'mentionedAgents';

export const mentionedAgentsKey = (topicId: string): string =>
  `${topicId}:${MENTIONED_AGENTS_SUFFIX}`;

export interface MentionedAgentsSnapshot {
  /** Formatted `<mentioned_agents>` block, byte-identical across operations. */
  content: string;
  /** Source-derived identity of the mentioned-agent set (no wall clock/random). */
  fingerprint: string;
  /** Deterministic carrier id derived from the same fingerprint. */
  id: string;
}

/** A snapshot that can be reused only while its source fingerprint matches. */
export interface FingerprintSnapshot {
  /** Source-derived identity: no wall-clock time, no random component. */
  fingerprint: string;
}

export class InjectionSnapshotStore {
  private readonly snapshots = new Map<string, unknown>();

  set<T>(key: string, value: T): void {
    this.snapshots.set(key, value);
  }

  get<T>(key: string): T | undefined {
    return this.snapshots.get(key) as T | undefined;
  }

  has(key: string): boolean {
    return this.snapshots.has(key);
  }

  /**
   * Return the stored snapshot only when it was derived from the same source.
   * A mismatch means the source changed, so the caller must refresh it.
   */
  getIfFresh<T extends FingerprintSnapshot>(key: string, fingerprint: string): T | undefined {
    const stored = this.snapshots.get(key) as T | undefined;
    return stored?.fingerprint === fingerprint ? stored : undefined;
  }

  /** Store (or replace) a snapshot and return the stored value. */
  refresh<T extends FingerprintSnapshot>(key: string, snapshot: T): T {
    this.snapshots.set(key, snapshot);
    return snapshot;
  }
}
