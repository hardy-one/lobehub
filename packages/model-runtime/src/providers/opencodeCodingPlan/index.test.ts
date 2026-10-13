// @vitest-environment node
import { ModelProvider } from 'model-bank';
import OpenAI from 'openai';
import { Stream } from 'openai/core/streaming';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as debugStreamModule from '../../utils/debugStream';
import {
  buildResponsesPayload,
  LobeOpenCodeCodingPlanAI,
  params,
  sanitizeJsonSchema,
} from './index';

const provider = ModelProvider.OpenCodeCodingPlan;
const defaultBaseURL = 'https://opencode.ai/zen/go/v1';

// Avoid a real models.dev fetch during router resolution; the failure path falls
// back to the hardcoded interleaved snapshot, which is what these tests assert on.
global.fetch = vi.fn().mockRejectedValue(new Error('no network in test')) as any;

// Silence the router's console.error on the mocked (never-resolving) fetch path.
vi.spyOn(console, 'error').mockImplementation(() => {});

describe('LobeOpenCodeCodingPlanAI', () => {
  describe('init', () => {
    it('should correctly initialize with an API key', () => {
      const instance = new LobeOpenCodeCodingPlanAI({ apiKey: 'test_api_key' });
      expect(instance).toBeInstanceOf(LobeOpenCodeCodingPlanAI);
    });
  });

  describe('provider configuration', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
    });

    it.each([
      [undefined, defaultBaseURL],
      ['https://proxy.example.com/go/v1', 'https://proxy.example.com/go/v1'],
      ['https://proxy.example.com/v1/gateway', 'https://proxy.example.com/v1/gateway'],
    ])('configures the single Responses route with baseURL=%s', (baseURL, expectedURL) => {
      const routers = params.routers({ apiKey: 'test', baseURL });

      expect(routers).toEqual([
        expect.objectContaining({
          apiType: 'openai',
          options: { apiKey: 'test', baseURL: expectedURL },
        }),
      ]);
    });

    it('identifies OpenCode Coding Plan and its default endpoint in API errors', async () => {
      vi.spyOn(OpenAI.Responses.prototype, 'create').mockRejectedValue(
        new OpenAI.APIError(401, { message: 'Unauthorized' }, 'Unauthorized', new Headers()),
      );
      const instance = new LobeOpenCodeCodingPlanAI({ apiKey: 'test' });

      await expect(
        instance.chat({ messages: [{ content: 'Hello', role: 'user' }], model: 'glm-5.3' }),
      ).rejects.toMatchObject({
        endpoint: defaultBaseURL,
        errorType: 'InvalidProviderAPIKey',
        provider,
      });
    });

    it.each([undefined, '0', '1'])(
      'enables streaming debug output only for DEBUG_OPENCODE_GO_CHAT_COMPLETION=1 (%s)',
      async (value) => {
        vi.stubEnv('DEBUG_OPENCODE_GO_CHAT_COMPLETION', value);
        const debugStream = vi.spyOn(debugStreamModule, 'debugStream').mockResolvedValue();
        vi.spyOn(debugStreamModule, 'debugPayload').mockImplementation(() => {});
        vi.spyOn(OpenAI.Responses.prototype, 'create').mockResolvedValue(
          Stream.fromReadableStream<OpenAI.Responses.ResponseStreamEvent>(
            new ReadableStream({ start: (controller) => controller.close() }),
            new AbortController(),
          ),
        );
        const instance = new LobeOpenCodeCodingPlanAI({ apiKey: 'test' });

        const response = await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'glm-5.3',
          stream: true,
        });
        await response.text();

        expect(params.debug.chatCompletion()).toBe(value === '1');
        expect(debugStream).toHaveBeenCalledTimes(value === '1' ? 1 : 0);
      },
    );
  });

  describe('Responses API routing', () => {
    let chatCreateSpy: Mock;
    let responsesCreateSpy: Mock;

    beforeEach(() => {
      chatCreateSpy = vi
        .spyOn(OpenAI.Chat.Completions.prototype, 'create')
        .mockResolvedValue(new ReadableStream() as any) as unknown as Mock;
      responsesCreateSpy = vi
        .spyOn(OpenAI.Responses.prototype, 'create')
        .mockResolvedValue(new ReadableStream() as any) as unknown as Mock;
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it.each(['glm-5.3', 'kimi-k3', 'qwen3.8-max', 'deepseek-v4-pro', 'claude-haiku-5-5'])(
      'routes %s chat through the Responses endpoint',
      async (model) => {
        const instance = new LobeOpenCodeCodingPlanAI({ apiKey: 'test' });

        await instance.chat({ messages: [{ content: 'Hello', role: 'user' }], model });

        expect(responsesCreateSpy).toHaveBeenCalledOnce();
        expect(chatCreateSpy).not.toHaveBeenCalled();
      },
    );

    it.each(['qwen3.8-max', 'minimax-m3'])(
      'overrides a saved Chat Completions preference for %s',
      async (model) => {
        const instance = new LobeOpenCodeCodingPlanAI({ apiKey: 'test' });

        await instance.chat({
          apiMode: 'chatCompletion',
          messages: [{ content: 'Hello', role: 'user' }],
          model,
        });

        expect(responsesCreateSpy).toHaveBeenCalledOnce();
        expect(chatCreateSpy).not.toHaveBeenCalled();
      },
    );

    it('generates structured output through the Responses endpoint', async () => {
      responsesCreateSpy.mockResolvedValue({ output_text: '{"answer":"Hello"}' });
      const instance = new LobeOpenCodeCodingPlanAI({ apiKey: 'test' });

      const result = await instance.generateObject({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'glm-5.3',
        schema: {
          name: 'answer',
          schema: { properties: { answer: { type: 'string' } }, type: 'object' },
        },
      });

      expect(result).toEqual({ answer: 'Hello' });
      expect(responsesCreateSpy).toHaveBeenCalledOnce();
      expect(chatCreateSpy).not.toHaveBeenCalled();
    });
  });

  describe('buildResponsesPayload output limits', () => {
    // The models.dev cache stays cold in this file (the global fetch rejects), so the
    // static model-bank card is the output-limit source.
    it('tops up max_tokens from the model card output limit', () => {
      const payload = buildResponsesPayload({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'glm-5.3',
      } as any);

      expect(payload.max_tokens).toBe(131_072);
    });

    it('keeps an explicit max_tokens', () => {
      const payload = buildResponsesPayload({
        max_tokens: 4096,
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'glm-5.3',
      } as any);

      expect(payload.max_tokens).toBe(4096);
    });

    it('leaves max_tokens unset for an unknown model', () => {
      const payload = buildResponsesPayload({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'not-a-model',
      } as any);

      expect('max_tokens' in payload).toBe(false);
    });
  });
});

describe('sanitizeJsonSchema', () => {
  it('should return non-object values as-is', () => {
    expect(sanitizeJsonSchema(null)).toBeNull();
    expect(sanitizeJsonSchema(undefined)).toBeUndefined();
    expect(sanitizeJsonSchema('string')).toBe('string');
    expect(sanitizeJsonSchema(42)).toBe(42);
  });

  it('should remove null from enum arrays', () => {
    const schema = {
      type: 'string',
      enum: ['heartbeat', 'schedule', null],
    };
    const result = sanitizeJsonSchema(schema);
    expect(result.enum).toEqual(['heartbeat', 'schedule']);
  });

  it('should simplify type: ["string", "null"] to type: "string"', () => {
    const schema = {
      type: ['string', 'null'],
      enum: ['heartbeat', 'schedule', null],
    };
    const result = sanitizeJsonSchema(schema);
    expect(result.type).toBe('string');
    expect(result.enum).toEqual(['heartbeat', 'schedule']);
  });

  it('should keep type: ["string", "number"] as array (no null)', () => {
    const schema = { type: ['string', 'number'] };
    expect(sanitizeJsonSchema(schema).type).toEqual(['string', 'number']);
  });

  it('should drop enum key if all values are null', () => {
    const schema = { type: 'string', enum: [null, null] };
    const result = sanitizeJsonSchema(schema);
    expect(result.enum).toBeUndefined();
  });

  it('should recurse into properties', () => {
    const schema = {
      type: 'object',
      properties: {
        action: {
          type: ['string', 'null'],
          enum: ['create', 'refine', 'consolidate', null],
        },
        name: { type: 'string' },
      },
    };
    const result = sanitizeJsonSchema(schema);
    expect(result.properties.action.enum).toEqual(['create', 'refine', 'consolidate']);
    expect(result.properties.action.type).toBe('string');
    expect(result.properties.name).toEqual({ type: 'string' });
  });

  it('should recurse into allOf/anyOf/oneOf', () => {
    const schema = {
      allOf: [
        { type: 'object', properties: { x: { enum: ['a', null] } } },
        { type: 'object', properties: { y: { enum: ['b', null] } } },
      ],
      anyOf: [{ enum: ['c', null] }, { type: ['string', 'null'] }],
    };
    const result = sanitizeJsonSchema(schema);
    expect(result.allOf[0].properties.x.enum).toEqual(['a']);
    expect(result.allOf[1].properties.y.enum).toEqual(['b']);
    expect(result.anyOf[0].enum).toEqual(['c']);
    expect(result.anyOf[1].type).toBe('string');
  });

  it('should recurse into items and prefixItems', () => {
    const schema = {
      type: 'array',
      items: {
        type: 'object',
        properties: { tag: { enum: ['alpha', 'beta', null] } },
      },
      prefixItems: [{ enum: ['x', null] }, { enum: ['y', null] }],
    };
    const result = sanitizeJsonSchema(schema);
    expect(result.items.properties.tag.enum).toEqual(['alpha', 'beta']);
    expect(result.prefixItems[0].enum).toEqual(['x']);
    expect(result.prefixItems[1].enum).toEqual(['y']);
  });

  it('should handle deeply nested schemas with $defs and if/then/else', () => {
    const schema = {
      $defs: {
        Foo: {
          type: 'object',
          properties: { status: { enum: ['ok', 'error', null] } },
        },
      },
      if: { properties: { x: { enum: ['a', null] } } },
      // `then` here is the JSON Schema if/then/else keyword, not a thenable.
      // eslint-disable-next-line unicorn/no-thenable
      then: { properties: { y: { type: ['string', 'null'] } } },
      else: { properties: { z: { enum: ['b', null] } } },
    };
    const result = sanitizeJsonSchema(schema);
    expect(result.$defs.Foo.properties.status.enum).toEqual(['ok', 'error']);
    expect(result.if.properties.x.enum).toEqual(['a']);
    expect(result.then.properties.y.type).toBe('string');
    expect(result.else.properties.z.enum).toEqual(['b']);
  });

  it('should handle schemas without nullable enums (no-op)', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        count: { type: 'integer' },
        tags: { type: 'array', items: { type: 'string' } },
      },
    };
    expect(sanitizeJsonSchema(schema)).toEqual(schema);
  });
});

describe('buildResponsesPayload Kimi thinking semantics', () => {
  const findAssistantMessage = (payload: any) =>
    payload.messages.find((message: any) => message.role === 'assistant');

  const conversation = [
    { content: 'Hello', role: 'user' },
    { content: 'Response', role: 'assistant' },
    { content: 'Follow-up', role: 'user' },
  ];

  describe('native-thinking K3 models (kimi-k3)', () => {
    it("should drop a saved thinking:disabled and keep reasoning_effort 'max' + forced reasoning_content", () => {
      const payload = buildResponsesPayload({
        messages: conversation,
        model: 'kimi-k3',
        reasoning_effort: 'max',
        thinking: { type: 'disabled' },
      } as any);

      // the Responses request must never carry the Chat Completions `thinking` switch
      expect('thinking' in payload).toBe(false);
      // disabled is ignored for native-thinking models; K3 accepts reasoning_effort 'max'.
      expect(payload.reasoning_effort).toBe('max');
      // assistant messages still get reasoning_content forced (fallback ' ').
      expect(findAssistantMessage(payload)?.reasoning_content).toBe(' ');
    });

    it("should drop a non-'max' reasoning_effort for kimi-k3", () => {
      const payload = buildResponsesPayload({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'kimi-k3',
        reasoning_effort: 'high',
      } as any);

      // K3 only accepts reasoning_effort 'max' (server default); other values are dropped
      // rather than sent and rejected.
      expect('reasoning_effort' in payload).toBe(false);
    });

    it('should not emit thinking even when thinking:enabled is provided', () => {
      const payload = buildResponsesPayload({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'kimi-k3',
        thinking: { type: 'enabled' },
      } as any);

      expect('thinking' in payload).toBe(false);
    });
  });

  describe('native-thinking K2.7 code model (kimi-k2.7-code)', () => {
    it('should not re-emit thinking:disabled and still force reasoning_content', () => {
      const payload = buildResponsesPayload({
        messages: conversation,
        model: 'kimi-k2.7-code',
        thinking: { type: 'disabled' },
      } as any);

      // Native-thinking models cannot turn reasoning off; disabled must not be re-emitted.
      expect('thinking' in payload).toBe(false);
      expect(findAssistantMessage(payload)?.reasoning_content).toBe(' ');
    });

    it("should pass through a non-'max' reasoning_effort unchanged (non-K3 model)", () => {
      const payload = buildResponsesPayload({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'kimi-k2.7-code',
        reasoning_effort: 'high',
      } as any);

      // Only K3+ (isKimiReasoningEffortModel) drops non-'max' efforts; k2.7-code keeps full passthrough.
      expect(payload.reasoning_effort).toBe('high');
    });
  });

  describe('non-Kimi models', () => {
    it('keeps the structured reasoning block so Responses can replay it', () => {
      const payload = buildResponsesPayload({
        messages: [
          { content: 'Hello', role: 'user' },
          {
            content: 'Response',
            reasoning: { content: 'thinking out loud', signature: 'sig-1' },
            role: 'assistant',
          },
        ],
        model: 'qwen3.8-flash',
      } as any);

      expect(payload.messages[1]).toMatchObject({
        content: 'Response',
        reasoning: { content: 'thinking out loud', signature: 'sig-1' },
      });
      expect('reasoning_content' in payload.messages[1]).toBe(false);
    });
  });

  describe('toggleable K2.x model (kimi-k2.6)', () => {
    it('should drop thinking:disabled and not force reasoning_content', () => {
      const payload = buildResponsesPayload({
        messages: conversation,
        model: 'kimi-k2.6',
        thinking: { type: 'disabled' },
      } as any);

      // `thinking` is Chat Completions only; the Responses endpoint rejects it.
      expect('thinking' in payload).toBe(false);
      // With thinking explicitly disabled, assistant messages are not forced to carry reasoning_content.
      expect(findAssistantMessage(payload)?.reasoning_content).toBeUndefined();
    });
  });
});
