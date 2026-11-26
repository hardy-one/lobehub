import { createHash } from 'node:crypto';

import { estimateTokenCount } from 'tokenx';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { estimateRequestInputTokens } from './estimateRequestInputTokens';
import { countRequestPayloadTokens, countRequestTokenViews } from './requestPayload';

vi.mock('tokenx', async (importOriginal) => {
  const original = await importOriginal<{ estimateTokenCount: typeof estimateTokenCount }>();
  return { ...original, estimateTokenCount: vi.fn(original.estimateTokenCount) };
});

describe('request token views', () => {
  beforeEach(() => vi.mocked(estimateTokenCount).mockClear());

  it('retains both accounting semantics while reusing identical text within one request', () => {
    const text = 'A unique long request message with enough text to estimate accurately.';
    const messages = [
      { content: 'system instructions', role: 'system' },
      { content: text, role: 'user' },
      {
        content: [
          { text: 'caption', type: 'text' },
          { image_url: { url: 'image' }, type: 'image_url' },
        ],
        role: 'user',
      },
      {
        content: '',
        reasoning: { content: 'thinking', signature: 'sig' },
        role: 'assistant',
        tool_calls: [{ function: { arguments: '{}', name: 'read' }, id: 'call', type: 'function' }],
      },
      { content: 'result', role: 'tool', tool_call_id: 'call' },
    ];
    const tools = [{ function: { name: 'read', parameters: {} }, type: 'function' }];
    const contextAccounting = countRequestPayloadTokens({ messages, tools });
    const estimatedInputTokens = estimateRequestInputTokens(messages, { tools });
    expect(
      vi.mocked(estimateTokenCount).mock.calls.filter(([value]) => value === text),
    ).toHaveLength(2);
    const totalCallsBefore = vi.mocked(estimateTokenCount).mock.calls.length;
    vi.mocked(estimateTokenCount).mockClear();

    const promptBefore = JSON.stringify(messages);
    const combined = countRequestTokenViews({ messages, tools });
    const promptAfter = JSON.stringify(messages);
    expect(promptAfter).toBe(promptBefore);
    console.log(
      JSON.stringify({
        case: 'mixed-request',
        before: estimatedInputTokens,
        after: combined.estimatedInputTokens,
        accountingBefore: contextAccounting.total,
        accountingAfter: combined.contextAccounting?.total,
        totalCallsBefore,
        totalCallsAfter: vi.mocked(estimateTokenCount).mock.calls.length,
        duplicateTextCallsBefore: 2,
        duplicateTextCallsAfter: 1,
        promptSha256Before: createHash('sha256').update(promptBefore).digest('hex'),
        promptSha256After: createHash('sha256').update(promptAfter).digest('hex'),
      }),
    );
    expect(combined).toEqual({
      contextAccounting,
      estimatedInputTokens,
    });
    expect(
      vi.mocked(estimateTokenCount).mock.calls.filter(([value]) => value === text),
    ).toHaveLength(1);
    countRequestTokenViews({ messages, tools });
    expect(
      vi.mocked(estimateTokenCount).mock.calls.filter(([value]) => value === text),
    ).toHaveLength(2);
  });

  it('preserves attachment and compression threshold estimates with changed request content', () => {
    const tools = [
      { function: { name: 'read', parameters: { type: 'object' } }, type: 'function' },
    ];
    for (const content of [
      'plain text',
      `question <files_info>${'attachment text '.repeat(200)}</files_info>`,
      `question <files_info>${'preview '.repeat(20)}</files_info>`,
    ]) {
      const messages = [{ content, role: 'user' }];
      const previous = estimateRequestInputTokens(messages, { tools });
      const current = countRequestTokenViews({ messages, tools });
      console.log(
        JSON.stringify({
          case: content.startsWith('plain')
            ? 'plain'
            : content.includes('attachment text')
              ? 'full-attachment'
              : 'preview-attachment',
          before: previous,
          after: current.estimatedInputTokens,
          thresholdBelow: previous - 1,
          thresholdEqual: previous,
          thresholdAbove: previous + 1,
          accounting: current.contextAccounting?.total,
          promptSha256: createHash('sha256').update(JSON.stringify(messages)).digest('hex'),
        }),
      );
      expect(current.estimatedInputTokens).toBe(previous);
      expect(current.contextAccounting).toEqual(countRequestPayloadTokens({ messages, tools }));
      for (const threshold of [previous - 1, previous, previous + 1]) {
        expect(current.estimatedInputTokens > threshold).toBe(previous > threshold);
      }
    }
  });

  it('traverses tool calls, tools and attachment parts only once for both views', () => {
    const textPart = { text: 'attachment text '.repeat(200), type: 'text' };
    const imagePart = { image_url: { url: 'data:image/png;base64,AAAA' }, type: 'image_url' };
    const toolCall = {
      function: { arguments: '{"path":"report.txt"}', name: 'read' },
      id: 'call-1',
      thoughtSignature: 'signature',
      type: 'function',
    };
    const toolSchema = {
      function: { description: 'Read an attachment', name: 'read', parameters: {} },
      type: 'function',
    };
    const messages = [
      { content: [textPart, imagePart], role: 'user' },
      { content: '', role: 'assistant', tool_calls: [toolCall] },
    ];
    const tools = [toolSchema];
    const expectedAccounting = countRequestPayloadTokens({ messages, tools });
    const expectedInput = estimateRequestInputTokens(messages, { tools });
    const textReads = vi.fn((_target, key: string) => key);
    const toolCallReads = vi.fn((_target, key: string) => key);
    const toolCallFunctionReads = vi.fn((_target, key: string) => key);
    const schemaReads = vi.fn((_target, key: string) => key);
    const imageReads = vi.fn((_target, key: string) => key);
    const observedMessages = [
      {
        content: [
          new Proxy(textPart, {
            get(target, key, receiver) {
              textReads(target, key);
              return Reflect.get(target, key, receiver);
            },
          }),
          new Proxy(imagePart, {
            get(target, key, receiver) {
              imageReads(target, key);
              return Reflect.get(target, key, receiver);
            },
          }),
        ],
        role: 'user',
      },
      {
        content: '',
        role: 'assistant',
        tool_calls: [
          new Proxy(toolCall, {
            get(target, key, receiver) {
              toolCallReads(target, key);
              const value = Reflect.get(target, key, receiver);
              return key === 'function'
                ? new Proxy(value, {
                    get(fnTarget, fnKey, fnReceiver) {
                      toolCallFunctionReads(fnTarget, fnKey);
                      return Reflect.get(fnTarget, fnKey, fnReceiver);
                    },
                  })
                : value;
            },
          }),
        ],
      },
    ];

    const combined = countRequestTokenViews({
      messages: observedMessages,
      tools: [
        new Proxy(toolSchema, {
          get(target, key, receiver) {
            schemaReads(target, key);
            return Reflect.get(target, key, receiver);
          },
        }),
      ],
    });

    expect(combined).toEqual({
      contextAccounting: expectedAccounting,
      estimatedInputTokens: expectedInput,
    });
    expect(
      schemaReads.mock.calls.filter(([, key]) => key === 'function').length,
    ).toBeLessThanOrEqual(3);
    expect(
      toolCallReads.mock.calls.filter(([, key]) => key === 'function').length,
    ).toBeLessThanOrEqual(6);
    expect(imageReads.mock.calls.filter(([, key]) => key === 'type').length).toBeLessThanOrEqual(2);
    expect(textReads.mock.calls.filter(([, key]) => key === 'text').length).toBeLessThanOrEqual(3);
  });
});
