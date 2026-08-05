import { estimateTokenCount } from 'tokenx';

/**
 * UI-facing token breakdown of a REAL request payload (the same messages +
 * tools array that was sent to the provider). The TokenTag shows these
 * measured buckets instead of client-side re-estimation, which cannot
 * reproduce a gateway/server-side send (different agent config source, tool
 * set, persona injection).
 *
 * Buckets mirror the TokenTag UI:
 *   - `systemRole` — assistant profile: system prompt preamble (rules,
 *     AGENTS.md, directory rules) + the injected `<user_memory>` persona
 *   - `tools` — skill setup: `<available_skills>` index + `<lobe_tool_policy>`
 *     teaching block + the request's `tools` schema
 *   - `historySummary` — previously compressed history (identified by
 *     `role: 'summary'` / `role: 'system'` summary markers)
 *   - `chats` — everything else (conversation window)
 *
 * Counting is plain `tokenx` (the same estimator TokenTag and the client
 * estimator use) — no drift multiplier, so the breakdown sums consistently
 * with the client's own estimate and with probe-measured payloads.
 */
export interface UiTokenBreakdown {
  /** Conversation window messages (excl. persona/system preamble). */
  chats?: number;
  /** Previously compressed history summary. */
  historySummary?: number;
  /** Assistant profile: system prompt preamble + `<user_memory>` persona. */
  systemRole?: number;
  /** Skill setup: skills index + tool policy + tools schema. */
  tools?: number;
}

const count = (text: unknown): number => {
  if (typeof text !== 'string' || text.length === 0) return 0;
  return estimateTokenCount(text);
};

const USER_MEMORY_MARKER = '<user_memory>';
const SKILLS_MARKER = '<available_skills>';
const POLICY_MARKER = '<lobe_tool_policy>';

/**
 * Split a system-prompt message into (preamble, skills+policy) blocks by the
 * same markers the runtime composes. Returns the original text as a single
 * preamble when no marker is present.
 */
const splitSystemPrompt = (content: string): { preamble: string; toolsBlock: string } => {
  const skillsIdx = content.indexOf(SKILLS_MARKER);
  const policyIdx = content.indexOf(POLICY_MARKER);
  if (skillsIdx < 0 && policyIdx < 0) return { preamble: content, toolsBlock: '' };

  const firstMarker =
    skillsIdx < 0 ? policyIdx : policyIdx < 0 ? skillsIdx : Math.min(skillsIdx, policyIdx);
  return {
    preamble: content.slice(0, firstMarker),
    toolsBlock: content.slice(firstMarker),
  };
};

const isSummaryMessage = (msg: {
  role?: string;
  content?: unknown;
  metadata?: unknown;
}): boolean => {
  if (msg.role === 'summary') return true;
  // Compressed history is carried as a system message with a summary marker.
  if (msg.role === 'system') {
    const metadata = msg.metadata as { summary?: unknown } | undefined;
    if (metadata?.summary) return true;
    const content = typeof msg.content === 'string' ? msg.content : '';
    return content.includes('[Summary]') || content.startsWith('## Summary');
  }
  return false;
};

/**
 * Estimate the UI breakdown of a real request payload (messages + tools).
 * Pure function — no store/network access; callers (server completion
 * lifecycle / client streaming executor) persist the result next to the
 * measured total.
 */
export const estimateUiBreakdown = (params: {
  messages?: unknown[];
  tools?: unknown[];
}): UiTokenBreakdown => {
  const { messages = [], tools = [] } = params;

  let systemRole = 0;
  let toolsTokens = 0;
  let historySummary = 0;
  let chats = 0;

  for (const raw of messages) {
    const msg = raw as {
      content?: unknown;
      metadata?: unknown;
      role?: string;
    };
    const content = typeof msg.content === 'string' ? msg.content : '';

    if (msg.role === 'system' || msg.role === 'developer') {
      if (isSummaryMessage(msg)) {
        historySummary += count(content);
      } else {
        const { preamble, toolsBlock } = splitSystemPrompt(content);
        systemRole += count(preamble);
        toolsTokens += count(toolsBlock);
      }
      continue;
    }

    if (content.startsWith(USER_MEMORY_MARKER)) {
      systemRole += count(content);
      continue;
    }

    if (isSummaryMessage(msg)) {
      historySummary += count(content);
      continue;
    }

    chats += count(content);
  }

  // The exact `tools` array that ships in the request payload.
  if (tools.length > 0) {
    toolsTokens += count(JSON.stringify(tools));
  }

  const breakdown: UiTokenBreakdown = {};
  if (systemRole > 0) breakdown.systemRole = systemRole;
  if (toolsTokens > 0) breakdown.tools = toolsTokens;
  if (historySummary > 0) breakdown.historySummary = historySummary;
  if (chats > 0) breakdown.chats = chats;
  return breakdown;
};
