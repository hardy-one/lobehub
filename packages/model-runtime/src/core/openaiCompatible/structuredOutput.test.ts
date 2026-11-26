// @vitest-environment node
import { createRequire } from 'node:module';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  parseStructuredOutputText,
  parseStructuredToolArguments,
  StructuredOutputError,
} from './structuredOutput';

afterEach(() => {
  vi.restoreAllMocks();
});

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
  const captureStructuredError = (run: () => unknown): StructuredOutputError => {
    try {
      run();
    } catch (error) {
      expect(error).toBeInstanceOf(StructuredOutputError);
      return error as StructuredOutputError;
    }
    throw new Error('expected structured output parsing to throw');
  };

  const debug = createRequire(import.meta.url)('debug');
  const createLogger = () => {
    const previousDebug = process.env.DEBUG;
    const log = vi.spyOn(debug, 'log').mockImplementation(() => {});
    process.env.DEBUG = 'lobe-model-runtime:structured-output';
    debug.enable(process.env.DEBUG);
    return {
      log,
      restore: () => {
        if (previousDebug === undefined) delete process.env.DEBUG;
        else process.env.DEBUG = previousDebug;
        debug.enable(previousDebug ?? '');
      },
    };
  };

  it('parses valid JSON string arguments', () => {
    expect(parseStructuredToolArguments('{"persona":"done"}')).toEqual({ persona: 'done' });
  });

  it('accepts an already parsed object', () => {
    expect(parseStructuredToolArguments({ persona: 'done' })).toEqual({ persona: 'done' });
  });

  it.each([
    { args: '{"a":1}}', parserPosition: 7 },
    { args: '{"a":1}\n  garbage', parserPosition: 10 },
    { args: '{"a":1}\r\n\tgarbage', parserPosition: 10 },
  ])(
    'recovers trailing content after a complete JSON object: $args',
    ({ args, parserPosition }) => {
      const { log, restore } = createLogger();

      try {
        expect(parseStructuredToolArguments(args)).toEqual({ a: 1 });
        expect(log.mock.calls.flat().join('\n')).toMatch(
          /structured output: recovered by truncating %d trailing characters/,
        );
        expect(log.mock.calls.flat()).toContain(args.length - parserPosition);
      } finally {
        restore();
      }
    },
  );

  it.each(['{"a":}', '{"a":1', '{"a":"b}'])(
    'still rejects JSON errors before the end of the value: %s',
    (args) => {
      expect(() => parseStructuredToolArguments(args)).toThrowError(
        /^Invalid structured output: invalid JSON in tool arguments$/,
      );
    },
  );

  it('recovers a trailing extra brace after a complete JSON object', () => {
    expect(parseStructuredToolArguments('{"a":1}}')).toEqual({ a: 1 });
  });

  it.each([
    { args: '}{"persona":"x","tagline":"y"}', expected: { persona: 'x', tagline: 'y' } },
    { args: '  }{"persona":"x"}', expected: { persona: 'x' } },
  ])('recovers one leading closing brace: $args', ({ args, expected }) => {
    const { log, restore } = createLogger();

    try {
      expect(parseStructuredToolArguments(args)).toEqual(expected);
      expect(log.mock.calls.flat().join('\n')).toMatch(
        /structured output: recovered by removing one leading closing brace/,
      );
    } finally {
      restore();
    }
  });

  it.each(['}{bad', '}[1,2]'])(
    'rejects a leading brace when the repaired value is not an object: %s',
    (args) => {
      const structuredError = captureStructuredError(() => parseStructuredToolArguments(args));

      expect(structuredError.reason).toBe('invalid JSON in tool arguments');
      expect(structuredError.context).toMatchObject({ argumentsLength: args.length });
    },
  );

  it('does not recover a leading brace when the provider reported truncation', () => {
    const args = '}{"persona":"x"}';
    const { log, restore } = createLogger();

    try {
      const structuredError = captureStructuredError(() =>
        parseStructuredToolArguments(args, { finishReason: 'length', truncated: true }),
      );

      expect(structuredError.reason).toBe('invalid JSON in tool arguments');
      expect(structuredError.context).toMatchObject({
        argumentsLength: args.length,
        finishReason: 'length',
        truncated: true,
      });
      expect(log).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('preserves the original error when the reported position cannot be recovered', () => {
    const { log, restore } = createLogger();
    vi.spyOn(JSON, 'parse').mockImplementationOnce(() => {
      throw new SyntaxError('Unexpected non-whitespace character after JSON at position 0');
    });

    const structuredError = captureStructuredError(() =>
      parseStructuredToolArguments('{"a":1}}', { finishReason: 'tool_calls' }),
    );

    expect(structuredError.reason).toBe('invalid JSON in tool arguments');
    expect(structuredError.context).toMatchObject({
      argumentsLength: 8,
      finishReason: 'tool_calls',
      jsonErrorPosition: 0,
      jsonErrorMessage: 'Unexpected non-whitespace character after JSON at position 0',
      jsonErrorSnippet: '<<<HERE>>>{"a":1}}',
    });
    try {
      expect(log).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('matches the after-JSON error case-insensitively', () => {
    const { log, restore } = createLogger();
    vi.spyOn(JSON, 'parse').mockImplementationOnce(() => {
      throw new SyntaxError('unexpected NON-WHITESPACE character AFTER json AT POSITION 7');
    });

    try {
      expect(parseStructuredToolArguments('{"a":1}}')).toEqual({ a: 1 });
      expect(log.mock.calls.flat().join('\n')).toMatch(
        /structured output: recovered by truncating %d trailing characters/,
      );
    } finally {
      restore();
    }
  });

  it('preserves the original error when the second parse fails', () => {
    const parserMessage = 'Unexpected non-whitespace character after JSON at position 3';
    vi.spyOn(JSON, 'parse')
      .mockImplementationOnce(() => {
        throw new SyntaxError(parserMessage);
      })
      .mockImplementationOnce(() => {
        throw new SyntaxError('prefix is still invalid');
      });

    const structuredError = captureStructuredError(() =>
      parseStructuredToolArguments('{"a":1}}', { finishReason: 'tool_calls', truncated: true }),
    );

    expect(structuredError.context).toEqual({
      argumentsLength: 8,
      charCodeAtPosition: 34,
      finishReason: 'tool_calls',
      jsonErrorMessage: parserMessage,
      jsonErrorPosition: 3,
      jsonErrorSnippet: '{"a<<<HERE>>>":1}}',
      truncated: true,
    });
  });

  it('does not scan past the parser-reported position', () => {
    const { log, restore } = createLogger();
    const args = '{"a":{"b":1}} trailing';
    vi.spyOn(JSON, 'parse').mockImplementationOnce(() => {
      throw new SyntaxError('Unexpected non-whitespace character after JSON at position 5');
    });

    const structuredError = captureStructuredError(() =>
      parseStructuredToolArguments(args, { finishReason: 'stop' }),
    );

    expect(structuredError.reason).toBe('invalid JSON in tool arguments');
    expect(structuredError.context?.jsonErrorPosition).toBe(5);
    try {
      expect(log).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('rejects a recovered non-object prefix', () => {
    const args = 'null garbage';

    const structuredError = captureStructuredError(() => parseStructuredToolArguments(args));

    expect(structuredError.reason).toBe('invalid JSON in tool arguments');
    expect(structuredError.context).toMatchObject({ argumentsLength: args.length });
  });

  it('reports invalid JSON with protocol metadata and a bounded snippet', () => {
    const args = '{"persona":"TOP_SECRET_PERSONA", "broken"';

    const structuredError = captureStructuredError(() =>
      parseStructuredToolArguments(args, { finishReason: 'length', truncated: true }),
    );

    expect(structuredError.reason).toBe('invalid JSON in tool arguments');
    expect(structuredError.context).toMatchObject({
      argumentsLength: args.length,
      finishReason: 'length',
      truncated: true,
    });
    expect(structuredError.message).not.toContain('TOP_SECRET_PERSONA');
    expect(structuredError.context?.jsonErrorMessage).toEqual(expect.any(String));
    expect(structuredError.context?.jsonErrorSnippet).toContain('TOP_SECRET_PERSONA');
    expect(structuredError.context?.jsonErrorSnippet).toContain('<<<HERE>>>');
    expect(String(structuredError.context?.jsonErrorSnippet).length).toBeLessThanOrEqual(700);
  });

  it('marks an unescaped newline in the arguments', () => {
    const args = '{"persona":"line one\nline two","done":true}';
    const newlinePosition = args.indexOf('\n');

    const structuredError = captureStructuredError(() => parseStructuredToolArguments(args));
    const snippet = structuredError.context?.jsonErrorSnippet as string;
    const [beforeMarker, afterMarker] = snippet.split('<<<HERE>>>');

    expect(newlinePosition).toBeGreaterThan(-1);
    expect(structuredError.context).toMatchObject({
      argumentsLength: args.length,
      charCodeAtPosition: 10,
      jsonErrorPosition: newlinePosition,
    });
    expect(beforeMarker.length).toBeGreaterThan(0);
    expect(afterMarker.length).toBeGreaterThan(0);
    expect(snippet).toContain('line one<<<HERE>>>\nline two');
  });

  it('reports the code unit and snippet content at an unescaped double quote', () => {
    const args = '{"persona":"She said ""hello"" today"}';

    const structuredError = captureStructuredError(() => parseStructuredToolArguments(args));

    expect(structuredError.context).toMatchObject({
      argumentsLength: args.length,
      charCodeAtPosition: 34,
    });
    expect(structuredError.context?.jsonErrorSnippet).toContain('She said "<<<HERE>>>"hello"');
  });

  it('still reports a non-empty snippet when the parser message carries no position', () => {
    const structuredError = captureStructuredError(() => parseStructuredToolArguments(''));

    expect(structuredError.reason).toBe('invalid JSON in tool arguments');
    expect(structuredError.context).toMatchObject({
      argumentsLength: 0,
      jsonErrorSnippet: '<<<HERE>>>',
    });
    expect(structuredError.context?.jsonErrorMessage).toEqual(expect.any(String));
    expect(structuredError.context?.jsonErrorPosition).toBeUndefined();
    expect(structuredError.context?.charCodeAtPosition).toBeUndefined();
  });

  it('records the parser error message verbatim', () => {
    const parserMessage = 'Unexpected token } in JSON at position 3';
    vi.spyOn(JSON, 'parse').mockImplementationOnce(() => {
      throw new SyntaxError(parserMessage);
    });

    const structuredError = captureStructuredError(() =>
      parseStructuredToolArguments('{"a":1}', { finishReason: 'stop' }),
    );

    expect(structuredError.context).toMatchObject({
      jsonErrorMessage: parserMessage,
      jsonErrorPosition: 3,
      jsonErrorSnippet: '{"a<<<HERE>>>":1}',
    });
  });

  it('caps a long snippet at 700 characters while keeping the marker', () => {
    const args = `{"blob":"${'a'.repeat(5000)}\n${'b'.repeat(5000)}"}`;

    const structuredError = captureStructuredError(() => parseStructuredToolArguments(args));
    const snippet = structuredError.context?.jsonErrorSnippet as string;

    expect(structuredError.context?.jsonErrorPosition).toBe(args.indexOf('\n'));
    expect(snippet).toContain('<<<HERE>>>');
    expect(snippet.length).toBeLessThanOrEqual(700);
  });

  it('falls back to the head of the arguments when the position cannot be parsed', () => {
    const args = `{"blob":"${'a'.repeat(5000)}", "broken"`;
    vi.spyOn(JSON, 'parse').mockImplementationOnce(() => {
      throw new SyntaxError('JSON parse failed without a location');
    });

    const structuredError = captureStructuredError(() => parseStructuredToolArguments(args));
    const snippet = structuredError.context?.jsonErrorSnippet as string;

    expect(structuredError.context?.jsonErrorMessage).toBe('JSON parse failed without a location');
    expect(structuredError.context?.jsonErrorPosition).toBeUndefined();
    expect(snippet.length).toBeGreaterThan(0);
    expect(snippet.length).toBeLessThanOrEqual(700);
    expect(snippet.startsWith('{"blob":"aaa')).toBe(true);
  });

  it('keeps the offset but omits the code unit when it points past the arguments', () => {
    const args = '{"broken"';

    const structuredError = captureStructuredError(() => parseStructuredToolArguments(args));

    expect(structuredError.context).toMatchObject({
      argumentsLength: args.length,
      jsonErrorPosition: args.length,
    });
    expect(structuredError.context?.charCodeAtPosition).toBeUndefined();
  });

  it('converts a line and column parser message to an offset', () => {
    const args = '{\n  bad';
    vi.spyOn(JSON, 'parse').mockImplementationOnce(() => {
      throw new SyntaxError('JSON.parse: unexpected character at line 2 column 3 of the JSON data');
    });

    const structuredError = captureStructuredError(() => parseStructuredToolArguments(args));

    expect(structuredError.context).toMatchObject({
      charCodeAtPosition: 'b'.charCodeAt(0),
      jsonErrorPosition: 4,
    });
  });

  it('reports a non-object JSON value as a shape error rather than malformed JSON', () => {
    expect(() => parseStructuredToolArguments('[1,2]', { finishReason: 'stop' })).toThrowError(
      /^Invalid structured output: JSON object required for tool arguments$/,
    );
  });
});
