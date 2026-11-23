import type { Debugger } from 'debug';

import type { GenerateObjectPayload } from '../../types';

/** An upstream structured-output response cannot satisfy the required tool-call contract. */
export class StructuredOutputError extends Error {
  /**
   * Protocol-level diagnostics (provider, model, finish reason, response
   * shape). Metadata only — never model-generated text, which can be private.
   */
  context?: Record<string, unknown>;

  /** Machine-readable failure reason, kept separate from the message for classifiers. */
  reason: string;

  constructor(reason: string, context?: Record<string, unknown>) {
    super(`Invalid structured output: ${reason}`);
    this.name = 'StructuredOutputError';
    this.reason = reason;
    this.context = context;
  }
}

/**
 * Protocol-level facts that explain why a tool-call response was rejected.
 * Metadata only: never carry model-generated text or parser messages.
 */
export interface StructuredToolArgumentsContext {
  /** Chat Completions `finish_reason`, Responses `status`, or Ollama `done_reason`. */
  finishReason?: null | string;
  /** Responses API `incomplete_details.reason`; `max_output_tokens` means truncated. */
  incompleteReason?: null | string;
  /** Whether the provider reported that generation stopped at a token limit. */
  truncated?: boolean;
}

const withArgumentsLength = (value: unknown, context: StructuredToolArgumentsContext) => ({
  ...context,
  ...(typeof value === 'string' ? { argumentsLength: value.length } : {}),
});

export const parseStructuredToolArguments = (
  value: unknown,
  context: StructuredToolArgumentsContext = {},
): Record<string, unknown> => {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      // Do not attach the raw response or parser error: both can contain private model output.
      throw new StructuredOutputError(
        'invalid JSON in tool arguments',
        withArgumentsLength(value, context),
      );
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new StructuredOutputError(
      'JSON object required for tool arguments',
      withArgumentsLength(value, context),
    );
  }
  return parsed as Record<string, unknown>;
};

/** Parse schema output, tolerating one fenced JSON block without repairing its contents. */
export const parseStructuredOutputText = (value: unknown): unknown => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new StructuredOutputError('missing JSON response text');
  }
  try {
    return JSON.parse(value);
  } catch {
    // Some compatible providers wrap a valid response in Markdown despite json_schema.
    // Only standalone fence lines delimit blocks; JSON strings may contain backticks.
    const fences = [...value.matchAll(/^[ \t]*```([^\r\n]*)\r?$/gm)];
    if (
      fences.length === 2 &&
      ['', 'json'].includes(fences[0][1].trim().toLowerCase()) &&
      fences[1][1].trim() === ''
    ) {
      const contents = value.slice(fences[0].index! + fences[0][0].length, fences[1].index);
      try {
        return JSON.parse(contents);
      } catch {
        // Preserve the same explicit failure and never include private response text.
      }
    }
    throw new StructuredOutputError('invalid JSON response text');
  }
};

/**
 * Total attempts for a forced tool call whose response cannot satisfy the
 * contract at the shape level. Some providers treat `tool_choice` as a soft
 * hint and answer in plain text instead (observed on DashScope-family gateways
 * at a ~10% rate); others call the tool but truncate or malform its JSON
 * arguments. Both are transient shape failures a resend can repair.
 */
const STRUCTURED_OUTPUT_MAX_ATTEMPTS = 3;

/**
 * Shape failures worth resending with a targeted reminder. Invalid JSON is
 * retryable because the model did call the tool and can usually repair its own
 * arguments. `JSON object required` is not: the reply was valid JSON but the
 * wrong shape, and the other reasons mean no parsable response was produced at
 * all, so a resend would only repeat the malformed contract.
 */
const RETRYABLE_STRUCTURED_OUTPUT_REASONS = [
  'invalid JSON in tool arguments',
  'no tool calls returned',
] as const;

type RetryableStructuredOutputReason = (typeof RETRYABLE_STRUCTURED_OUTPUT_REASONS)[number];

const isRetryableStructuredOutputError = (
  error: unknown,
): error is StructuredOutputError & { reason: RetryableStructuredOutputReason } =>
  error instanceof StructuredOutputError &&
  (RETRYABLE_STRUCTURED_OUTPUT_REASONS as readonly string[]).includes(error.reason);

const RETRY_REMINDERS: Record<RetryableStructuredOutputReason, string> = {
  'invalid JSON in tool arguments':
    'Your previous tool arguments were not valid JSON. Call the same tool again and provide a single valid JSON object as its arguments. Output only that JSON object — do not wrap it in a Markdown code block or add any other text.',
  'no tool calls returned':
    'Your previous response did not call a tool. You must call one of the provided tools now to return your result — do not answer in plain text.',
};

const reinforceToolCallRequest = (
  payload: GenerateObjectPayload,
  reason: RetryableStructuredOutputReason,
): GenerateObjectPayload => ({
  ...payload,
  messages: [
    ...payload.messages,
    {
      content: RETRY_REMINDERS[reason],
      role: 'user' as const,
    },
  ],
});

/**
 * Runs a forced tool-call request, retrying shape failures (plain text instead
 * of a tool call, or invalid JSON arguments) up to
 * STRUCTURED_OUTPUT_MAX_ATTEMPTS total attempts. The final error carries
 * `attempts` in its diagnostic context.
 */
export const retryStructuredToolCalls = async <T>(
  payload: GenerateObjectPayload,
  attemptCall: (payload: GenerateObjectPayload) => Promise<T>,
  log?: Debugger,
): Promise<T> => {
  let current = payload;

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await attemptCall(current);
    } catch (error) {
      if (!isRetryableStructuredOutputError(error) || attempt >= STRUCTURED_OUTPUT_MAX_ATTEMPTS) {
        if (isRetryableStructuredOutputError(error)) {
          error.context = { ...error.context, attempts: attempt };
        }
        throw error;
      }
      log?.('structured output: attempt %d failed with %s, retrying', attempt, error.reason);
      current = reinforceToolCallRequest(current, error.reason);
    }
  }
};
