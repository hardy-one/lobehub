import { describe, expect, it, vi } from 'vitest';

import {
  parseStructuredOutputText,
  parseStructuredToolArguments,
  retryStructuredToolCalls,
  StructuredOutputError,
} from './structuredOutput';

describe('parseStructuredOutputText', () => {
  it.each([
    '{"ready":true}',
    '```json\n{"ready":true}\n```',
    '```JSON\n{"ready":true}\n```',
    '```JsOn\n{"ready":true}\n```',
    'Summary\n```json\r\n{"ready":true}\r\n```\nDone',
    '```\n{"ready":true}\n```',
  ])('reads a single unambiguous JSON value: %s', (text) => {
    expect(parseStructuredOutputText(text)).toEqual({ ready: true });
  });
  it('preserves fence literals inside JSON strings', () => {
    expect(parseStructuredOutputText('```json\n{"snippet":"```"}\n```')).toEqual({
      snippet: '```',
    });
  });
  it.each(['[1,2]', 'null', 'true'])('preserves valid JSON schema output %s', (text) => {
    expect(parseStructuredOutputText(text)).toEqual(JSON.parse(text));
  });
  it.each([
    undefined,
    '',
    'private secret',
    '```json\n{"private":\n```',
    '```json\n{}\n```\n```json\n{}\n```',
    '```javascript\n{}\n```',
    '```json\n{}',
    '```json\n{bad}\n```',
  ])('rejects missing, invalid or ambiguous output without leaking it', (text) => {
    expect(() => parseStructuredOutputText(text)).toThrowError(
      /^Invalid structured output: (missing|invalid) JSON response text$/,
    );
  });
});

describe('parseStructuredToolArguments', () => {
  it('parses valid JSON string arguments', () => {
    expect(parseStructuredToolArguments('{"persona":"done"}')).toEqual({ persona: 'done' });
  });

  it('accepts an already parsed object', () => {
    expect(parseStructuredToolArguments({ persona: 'done' })).toEqual({ persona: 'done' });
  });

  it('reports invalid JSON with protocol metadata and no raw arguments', () => {
    const args = '{"persona":"TOP_SECRET_PERSONA", "broken"';

    try {
      parseStructuredToolArguments(args, { finishReason: 'length', truncated: true });
      throw new Error('expected parse to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(StructuredOutputError);
      const structuredError = error as StructuredOutputError;
      expect(structuredError.reason).toBe('invalid JSON in tool arguments');
      expect(structuredError.context).toEqual({
        argumentsLength: args.length,
        finishReason: 'length',
        truncated: true,
      });
      expect(structuredError.message).not.toContain('TOP_SECRET_PERSONA');
      expect(JSON.stringify(structuredError.context)).not.toContain('TOP_SECRET_PERSONA');
    }
  });

  it('reports a non-object JSON value without retrying it as malformed JSON', () => {
    expect(() => parseStructuredToolArguments('[1,2]', { finishReason: 'stop' })).toThrowError(
      /^Invalid structured output: JSON object required for tool arguments$/,
    );
  });
});

describe('retryStructuredToolCalls', () => {
  const payload = {
    messages: [{ content: 'Write the persona', role: 'user' as const }],
    model: 'qwen-token-plan/qwen3.8-flash',
    tools: [
      { function: { name: 'commit_user_persona', parameters: {} }, type: 'function' as const },
    ],
  };

  it('retries invalid JSON with a JSON-specific reminder', async () => {
    const attemptCall = vi
      .fn()
      .mockRejectedValueOnce(
        new StructuredOutputError('invalid JSON in tool arguments', { argumentsLength: 8 }),
      )
      .mockResolvedValue('ok');

    await expect(retryStructuredToolCalls(payload, attemptCall)).resolves.toBe('ok');
    expect(attemptCall).toHaveBeenCalledTimes(2);
    expect(attemptCall.mock.calls[1][0].messages.at(-1).content).toContain(
      'previous tool arguments were not valid JSON',
    );
  });

  it('adds the attempt count only when the retry budget is exhausted', async () => {
    const invalidJson = () =>
      new StructuredOutputError('invalid JSON in tool arguments', { argumentsLength: 8 });
    const attemptCall = vi.fn(async () => {
      throw invalidJson();
    });

    await expect(retryStructuredToolCalls(payload, attemptCall)).rejects.toMatchObject({
      context: { argumentsLength: 8, attempts: 3 },
      reason: 'invalid JSON in tool arguments',
    });
    expect(attemptCall).toHaveBeenCalledTimes(3);
  });

  it.each(['JSON object required for tool arguments', 'invalid JSON response text'])(
    'does not retry the hard reason %s',
    async (reason) => {
      const attemptCall = vi.fn(async () => {
        throw new StructuredOutputError(reason);
      });

      await expect(retryStructuredToolCalls(payload, attemptCall)).rejects.toMatchObject({
        context: undefined,
        reason,
      });
      expect(attemptCall).toHaveBeenCalledTimes(1);
    },
  );
});
