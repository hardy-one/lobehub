import { createHash } from 'node:crypto';

type JsonValue = boolean | null | number | string | JsonValue[] | { [key: string]: JsonValue };

export const PROMPT_HARNESS_CANONICALIZATION = 'prompt-harness-canonical-json-v2';

const normalizeVolatileLocalOrigin = (value: string): string =>
  value.replaceAll(/https?:\/\/(?:127\.0\.0\.1|localhost):\d+/g, 'http://loopback.invalid');

const canonicalize = (value: unknown): JsonValue | undefined => {
  if (value === undefined) return undefined;
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return normalizeVolatileLocalOrigin(value);
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item) ?? null);
  }
  if (typeof value === 'object') {
    const result: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort()) {
      const normalized = canonicalize((value as Record<string, unknown>)[key]);
      if (normalized !== undefined) result[key] = normalized;
    }
    return result;
  }
  return String(value);
};

export const canonicalJson = (value: unknown): string =>
  JSON.stringify(canonicalize(value) ?? null);

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

export const canonicalHash = (value: unknown): string => `sha256:${sha256(canonicalJson(value))}`;

export interface PromptRequestHashes {
  full: string;
  messages: string;
  messagesAndTools: string;
  tools: string;
}

/**
 * Prompt-harness canonical-json-v2: recursively sorted object keys, array
 * order preserved, volatile loopback test origins normalized, compact JSON,
 * then SHA-256. The schema/version is part of every fixture so a hash change
 * has an explicit cause.
 */
export const hashPromptRequest = (
  request: { messages?: unknown; tools?: unknown } & Record<string, unknown>,
): PromptRequestHashes => ({
  full: canonicalHash(request),
  messages: canonicalHash(request.messages),
  messagesAndTools: canonicalHash({ messages: request.messages, tools: request.tools }),
  tools: canonicalHash(request.tools),
});

/**
 * Schema version for the environment-stable legacy baseline hash. Bumped when
 * the baseline hash scope changes so a hash difference has an explicit cause.
 */
export const PROMPT_HARNESS_BASELINE_CANONICALIZATION = 'prompt-harness-baseline-json-v3';

/**
 * Context blocks whose contents are derived from runtime environment state: the
 * installed-but-disabled plugin catalogue (`<available_tools>`) and the recent
 * agent roster (`<agent_management_context>`). They drift with plugin install
 * state and seed data, so they are excluded from the stable baseline hash and
 * recorded separately in fixture provenance instead.
 */
export const ENV_DERIVED_BLOCKS = ['available_tools', 'agent_management_context'] as const;

export interface EnvironmentSnapshot {
  availableAgents: string[];
  availableTools: string[];
}

const envBlockContentRegExp = (tag: string): RegExp =>
  new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'g');

const envBlockWholeRegExp = (tag: string): RegExp =>
  new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'g');

const stripEnvBlocks = (value: string): string => {
  let result = value;
  for (const tag of ENV_DERIVED_BLOCKS) {
    result = result.replace(envBlockWholeRegExp(tag), `[<${tag}>]`);
  }
  return result;
};

const transformContent = (content: unknown): unknown => {
  if (typeof content === 'string') return stripEnvBlocks(content);
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (
        part &&
        typeof part === 'object' &&
        typeof (part as { text?: unknown }).text === 'string'
      ) {
        return { ...(part as Record<string, unknown>), text: stripEnvBlocks((part as { text: string }).text) };
      }
      return part;
    });
  }
  return content;
};

const collectContentText = (content: unknown): string[] => {
  if (typeof content === 'string') return [content];
  if (Array.isArray(content)) {
    return content.flatMap((part) =>
      part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string'
        ? [(part as { text: string }).text]
        : [],
    );
  }
  return [];
};

const messageTexts = (request: { messages?: unknown }): string[] =>
  Array.isArray(request.messages)
    ? request.messages.flatMap((message) =>
        message && typeof message === 'object'
          ? collectContentText((message as { content?: unknown }).content)
          : [],
      )
    : [];

/**
 * Replace environment-derived blocks with a stable placeholder so the baseline
 * hash only covers request bytes the PR actually controls. Object key order and
 * array order are still canonicalized/hashed; only the drifting block bodies are
 * neutralized.
 */
export const normalizeRequestForBaseline = <T extends { messages?: unknown }>(request: T): T => {
  if (!Array.isArray(request.messages)) return request;
  return {
    ...request,
    messages: request.messages.map((message) =>
      message && typeof message === 'object'
        ? { ...message, content: transformContent((message as { content?: unknown }).content) }
        : message,
    ),
  };
};

const extractBlockLines = (request: { messages?: unknown }, tag: string): string[] => {
  const lines: string[] = [];
  for (const content of messageTexts(request)) {
    const re = envBlockContentRegExp(tag);
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
      for (const line of match[1].split('\n')) {
        const trimmed = line.trim();
        if (trimmed) lines.push(trimmed);
      }
    }
  }
  return [...new Set(lines)].sort();
};

/** Snapshot of the environment-derived inputs, recorded in fixture provenance. */
export const extractEnvironmentSnapshot = (request: {
  messages?: unknown;
}): EnvironmentSnapshot => ({
  availableAgents: extractBlockLines(request, 'agent_management_context'),
  availableTools: extractBlockLines(request, 'available_tools'),
});

/**
 * Stable baseline hash: same four hash fields as `hashPromptRequest`, but over
 * the environment-normalized request so plugin/roster drift cannot move it.
 */
export const hashBaselineRequest = (
  request: { messages?: unknown; tools?: unknown } & Record<string, unknown>,
): PromptRequestHashes => hashPromptRequest(normalizeRequestForBaseline(request));

const SECRET_HEADERS = new Set([
  'authorization',
  'cookie',
  'proxy-authorization',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
]);

export const redactHeaders = (
  headers: Record<string, string | string[] | undefined>,
): Record<string, string | string[]> => {
  const result: Record<string, string | string[]> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    result[key] = SECRET_HEADERS.has(key.toLowerCase()) ? '[REDACTED]' : value;
  }

  return result;
};

export const findSensitiveHeader = (
  headers: Record<string, string | string[] | undefined>,
): string | undefined => {
  const key = Object.keys(headers).find((name) => {
    const lower = name.toLowerCase();
    return SECRET_HEADERS.has(lower) || lower.includes('credential') || lower.includes('secret');
  });
  if (!key) return undefined;

  const value = headers[key];
  if (value === undefined || value === '[REDACTED]') return undefined;
  if (Array.isArray(value)) {
    return value.some((item) => item && item !== '[REDACTED]') ? key : undefined;
  }
  return value ? key : undefined;
};
