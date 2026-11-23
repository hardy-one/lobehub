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
} as const;

export type InjectionSourceKey = (typeof INJECTION_SOURCE_KEYS)[keyof typeof INJECTION_SOURCE_KEYS];
