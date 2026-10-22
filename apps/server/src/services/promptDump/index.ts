import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

import type { ChatStreamPayload, OnFinishData } from '@lobechat/model-runtime';
import debug from 'debug';

const log = debug('lobe-server:prompt-dump');

const DEFAULT_DUMP_PATH = '/app/dumps';

/** Calls without a resolvable topic land here instead of the root, so the root stays a clean list of topics. */
const NO_TOPIC_BUCKET = '_no-topic';

const MAX_BUCKET_LENGTH = 96;

export const isPromptDumpEnabled = (): boolean => process.env.PROMPT_DUMP_ENABLED === '1';

export const resolvePromptDumpRoot = (): string =>
  process.env.PROMPT_DUMP_PATH?.trim() || DEFAULT_DUMP_PATH;

/** Topic ids reach us from user input, so they are reduced to a single safe path segment. */
export const resolveTopicBucket = (topicId?: string | null): string => {
  const sanitized = (topicId ?? '')
    .trim()
    .replaceAll(/[^\w.-]/g, '_')
    .slice(0, MAX_BUCKET_LENGTH)
    .replaceAll(/^[._-]+|[._-]+$/g, '');

  return sanitized || NO_TOPIC_BUCKET;
};

const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

/**
 * An `Error` reached the provider boundary, so it never passed through the
 * reply path: serialise the fields that carry the diagnosis. Anything else is
 * already a payload and is mirrored verbatim.
 */
const serializeError = (error: unknown): unknown => {
  if (error instanceof Error) {
    return { message: error.message, name: error.name, stack: error.stack };
  }

  return error;
};

/**
 * Cycle-safe fallback used only when the payload cannot be serialised at all —
 * a circular structure never reaches a provider, so this path is a diagnostic
 * record, not a mirror. The marker also collapses repeated non-cyclic nodes,
 * which is acceptable here because the body is already unmirrorable.
 */
const stringifyCycleSafe = (value: unknown): string => {
  const seen = new WeakSet<object>();

  return (
    JSON.stringify(
      value,
      (_key, item: unknown) => {
        if (typeof item === 'object' && item !== null) {
          if (seen.has(item)) return '[circular]';
          seen.add(item);
        }
        return item;
      },
      2,
    ) ?? 'null'
  );
};

/**
 * Serialise the mirrored body. The first attempt is a plain `JSON.stringify`,
 * so a payload that reuses one object at several paths (tool schemas do) is
 * written byte-for-byte as the wire body would be.
 */
const stringify = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2) ?? 'null';
  } catch (error) {
    console.error('[prompt-dump] payload is not serialisable, recording a cycle-safe copy:', error);
    return stringifyCycleSafe(value);
  }
};

const writeJsonFile = async (filePath: string, value: unknown): Promise<void> => {
  try {
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${stringify(value)}\n`, 'utf8');
  } catch (error) {
    console.error('[prompt-dump] failed to write', filePath, error);
  }
};

export interface PromptDumpCallContext {
  model?: string;
  /** Agent run this call belongs to; groups every request of one multi-step operation. */
  operationId?: string;
  /** Provider id as configured by the user. */
  provider: string;
  /** Adapter actually serving the call, when it differs from `provider`. */
  runtimeProvider?: string;
  topicId?: string;
  trigger?: string;
  userId?: string;
  workspaceId?: string;
}

/**
 * One LLM call. `recordRequest` fires before the provider is reached, so a
 * stream that dies mid-flight still leaves the exact context that was sent.
 * Every write is fire-and-forget: a mirror that cannot be written must never
 * take the conversation down with it.
 */
export class PromptDumpCallRecorder {
  private readonly callId = randomUUID().slice(0, 8);
  private readonly directory: string;
  private readonly filePrefix: string;
  private readonly startedAt = Date.now();

  constructor(
    root: string,
    private readonly context: PromptDumpCallContext,
  ) {
    this.directory = path.resolve(root, resolveTopicBucket(context.topicId));
    // The prefix fixes both files of a call next to each other and keeps
    // directory listings ordered by call start, even when the response file
    // lands much later than the request file.
    this.filePrefix = `${this.startedAt}-${this.callId}`;
  }

  /** Mirror the payload exactly as it is handed to the provider — no rewriting. */
  recordRequest(payload: ChatStreamPayload): Promise<void> {
    const body = stringify(payload);
    const request = {
      // Digest of the mirrored body, so two calls compare equal exactly when
      // their bodies do.
      fingerprint: digest(body),
      payload,
    };

    return writeJsonFile(path.join(this.directory, `${this.filePrefix}-request.json`), {
      callId: this.callId,
      kind: 'request',
      startedAt: new Date(this.startedAt).toISOString(),
      ...this.context,
      request,
    });
  }

  recordResponse(data: OnFinishData): Promise<void> {
    return writeJsonFile(path.join(this.directory, `${this.filePrefix}-response.json`), {
      callId: this.callId,
      durationMs: Date.now() - this.startedAt,
      kind: 'response',
      model: this.context.model,
      operationId: this.context.operationId,
      provider: this.context.provider,
      response: data,
      topicId: this.context.topicId,
    });
  }

  recordError(error: unknown): Promise<void> {
    return writeJsonFile(path.join(this.directory, `${this.filePrefix}-error.json`), {
      callId: this.callId,
      durationMs: Date.now() - this.startedAt,
      error: serializeError(error),
      kind: 'error',
      model: this.context.model,
      operationId: this.context.operationId,
      provider: this.context.provider,
      topicId: this.context.topicId,
    });
  }
}

/**
 * An exact-prefix mirror of every LLM request this deployment sends, written to
 * a host-mounted directory so prompt-cache behaviour can be analysed offline.
 *
 * Cache hits depend on the byte-level identity of the request prefix, which no
 * log line can show. Mirroring the assembled request (messages, tools, model
 * parameters) plus the provider's own usage report lets a diff between two
 * consecutive calls name the exact block that broke the prefix — a timestamp
 * injected into the system prompt, a tool list reordered by an activator, a
 * retrieval block that moved above the history.
 *
 * The payload is written verbatim, base64 images and all: a rewritten body
 * cannot be diffed against the bytes the cache keys on, and the operator who
 * turns this on is the one whose own conversations are being analysed. Expect
 * mirror size to track prompt size, images included. Credentials never reach
 * here — the mirror records the model payload, not the transport headers.
 *
 * Off by default: it persists full conversation content to disk.
 */
export class PromptDumpService {
  isEnabled(): boolean {
    return isPromptDumpEnabled();
  }

  beginCall(context: PromptDumpCallContext): PromptDumpCallRecorder | null {
    if (!this.isEnabled()) return null;

    const root = resolvePromptDumpRoot();
    log('mirroring LLM call provider=%s topic=%s to %s', context.provider, context.topicId, root);

    return new PromptDumpCallRecorder(root, context);
  }
}

let cachedInstance: PromptDumpService | null = null;

export const getPromptDumpService = (): PromptDumpService => {
  if (!cachedInstance) cachedInstance = new PromptDumpService();
  return cachedInstance;
};
