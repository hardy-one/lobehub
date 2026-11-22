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

export const parseStructuredToolArguments = (value: unknown): Record<string, unknown> => {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      // Do not attach the raw response or parser error: both can contain private model output.
      throw new StructuredOutputError('invalid JSON in tool arguments');
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new StructuredOutputError('JSON object required for tool arguments');
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
 * Total attempts for a forced tool call that comes back with no tool call at
 * all. Some providers treat `tool_choice` as a soft hint and answer in plain
 * text instead (observed on DashScope-family gateways at a ~10% rate), which
 * is a transient, retryable shape failure — not a contract violation.
 */
const STRUCTURED_OUTPUT_MAX_ATTEMPTS = 3;

/**
 * A tool-call response with no tool call, retried with an explicit reminder.
 * Other StructuredOutputError reasons (malformed arguments, unparseable text)
 * mean the model did answer through the contract and a resend would not help.
 */
const isMissingToolCallError = (error: unknown): error is StructuredOutputError =>
  error instanceof StructuredOutputError && error.reason === 'no tool calls returned';

const reinforceToolCallRequest = (payload: GenerateObjectPayload): GenerateObjectPayload => ({
  ...payload,
  messages: [
    ...payload.messages,
    {
      content:
        'Your previous response did not call a tool. You must call one of the provided tools now to return your result — do not answer in plain text.',
      role: 'user' as const,
    },
  ],
});

/**
 * Runs a forced tool-call request, retrying the "answered in plain text"
 * shape failure up to STRUCTURED_OUTPUT_MAX_ATTEMPTS total attempts. The
 * final error carries `attempts` in its diagnostic context.
 */
export const retryMissingToolCalls = async <T>(
  payload: GenerateObjectPayload,
  attemptCall: (payload: GenerateObjectPayload) => Promise<T>,
  log?: Debugger,
): Promise<T> => {
  let current = payload;

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await attemptCall(current);
    } catch (error) {
      if (!isMissingToolCallError(error) || attempt >= STRUCTURED_OUTPUT_MAX_ATTEMPTS) {
        if (isMissingToolCallError(error)) error.context = { ...error.context, attempts: attempt };
        throw error;
      }
      log?.('structured output: attempt %d returned no tool calls, retrying', attempt);
      current = reinforceToolCallRequest(current);
    }
  }
};
