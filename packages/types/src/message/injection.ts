/**
 * Canonical `messages.source_key` values for append-only v2 injected rows.
 *
 * An injected row (`is_injection = true`) persists the exact context an
 * injector produced, so request assembly can replay it instead of rebuilding
 * it. Every persisted-injection source must be named here; the database, the
 * context engine and future writers all read the same table so a source can
 * never drift into two spellings.
 */
export const INJECTION_SOURCE_KEYS = {
  /** `AgentDocumentMessageInjector` (after-first-user / context-end). */
  AGENT_DOC_MESSAGE: 'agent_doc_message',
  /** `AgentDocumentChangesInjector`'s per-user snapshot diff. */
  AGENT_DOC_CHANGES: 'agent_doc_changes',
  /** `AgentManagementContextInjector`'s `<mentioned_agents>` delegation hint. */
  MENTION_DELEGATION: 'mention_delegation',
  /** `SelectedSkillInjector`'s `<selected_skill_context>` block. */
  SELECTED_SKILL: 'selected_skill',
  /** `SelectedToolInjector`'s `<selected_tool_context>` block. */
  SELECTED_TOOL: 'selected_tool',
  /** `ContextSelectionsInjector`'s message-owned selection block. */
  CONTEXT_SELECTIONS: 'context_selections',
} as const;

export type InjectionSourceKey = (typeof INJECTION_SOURCE_KEYS)[keyof typeof INJECTION_SOURCE_KEYS];

/**
 * Runtime guard for the canonical key table. Writers validate against this
 * before persisting so a typo can never create a source the engine will not
 * replay; the database only enforces that `source_key` is present.
 */
export const isInjectionSourceKey = (value: string): value is InjectionSourceKey =>
  (Object.values(INJECTION_SOURCE_KEYS) as string[]).includes(value);
