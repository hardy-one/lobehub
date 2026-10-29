// @vitest-environment node
import Anthropic from '@anthropic-ai/sdk';
import { ModelProvider } from 'model-bank';
import OpenAI from 'openai';
import { Stream } from 'openai/core/streaming';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as debugStreamModule from '../../utils/debugStream';
import { buildResponsesPayload, LobeOpenCodeZenAI, params, sanitizeJsonSchema } from './index';

const provider = ModelProvider.OpenCodeZen;
const defaultBaseURL = 'https://opencode.ai/zen/v1';
const stripV1 = (url: string) => url.replace(/\/v1$/, '');

// Avoid a real models.dev fetch during router resolution; the failure path falls
// back to the hardcoded interleaved snapshot, which is what these tests assert on.
global.fetch = vi.fn().mockRejectedValue(new Error('no network in test')) as any;

// Silence the router's console.error on the mocked (never-resolving) fetch path.
vi.spyOn(console, 'error').mockImplementation(() => {});

describe('LobeOpenCodeZenAI', () => {
  describe('init', () => {
    it('should correctly initialize with an API key', () => {
      const instance = new LobeOpenCodeZenAI({ apiKey: 'test_api_key' });
      expect(instance).toBeInstanceOf(LobeOpenCodeZenAI);
    });
  });

  describe('provider configuration', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
    });

    it.each([
      [undefined, defaultBaseURL],
      ['https://proxy.example.com/zen/v1', 'https://proxy.example.com/zen/v1'],
      ['https://proxy.example.com/v1/gateway', 'https://proxy.example.com/v1/gateway'],
    ])('configures one route per protocol with baseURL=%s', (baseURL, expectedURL) => {
      const routers = params.routers({ apiKey: 'test', baseURL });

      expect(routers).toEqual([
        // The Anthropic SDK appends /v1/messages itself, so its baseURL loses the suffix.
        expect.objectContaining({
          apiType: 'anthropic',
          options: { apiKey: 'test', baseURL: stripV1(expectedURL) },
        }),
        expect.objectContaining({
          apiType: 'google',
          options: { apiKey: 'test', baseURL: expectedURL },
        }),
        expect.objectContaining({
          apiType: 'openai',
          options: { apiKey: 'test', baseURL: expectedURL, modelSdkType: 'openai-responses' },
        }),
        expect.objectContaining({
          apiType: 'openai',
          options: { apiKey: 'test', baseURL: expectedURL, modelSdkType: 'openai' },
        }),
      ]);
    });

    it('identifies OpenCode Zen and its default endpoint in API errors', async () => {
      vi.spyOn(OpenAI.Chat.Completions.prototype, 'create').mockRejectedValue(
        new OpenAI.APIError(401, { message: 'Unauthorized' }, 'Unauthorized', new Headers()),
      );
      const instance = new LobeOpenCodeZenAI({ apiKey: 'test' });

      await expect(
        instance.chat({ messages: [{ content: 'Hello', role: 'user' }], model: 'glm-5.3' }),
      ).rejects.toMatchObject({
        endpoint: defaultBaseURL,
        errorType: 'InvalidProviderAPIKey',
        provider,
      });
    });

    it.each([undefined, '0', '1'])(
      'enables streaming debug output only for DEBUG_OPENCODE_ZEN_CHAT_COMPLETION=1 (%s)',
      async (value) => {
        vi.stubEnv('DEBUG_OPENCODE_ZEN_CHAT_COMPLETION', value);
        const debugStream = vi.spyOn(debugStreamModule, 'debugStream').mockResolvedValue();
        vi.spyOn(debugStreamModule, 'debugPayload').mockImplementation(() => {});
        vi.spyOn(OpenAI.Chat.Completions.prototype, 'create').mockResolvedValue(
          Stream.fromReadableStream<OpenAI.ChatCompletionChunk>(
            new ReadableStream({ start: (controller) => controller.close() }),
            new AbortController(),
          ),
        );
        const instance = new LobeOpenCodeZenAI({ apiKey: 'test' });

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

  describe('per-model protocol routing', () => {
    let anthropicSpy: Mock;
    let chatCreateSpy: Mock;
    let responsesCreateSpy: Mock;

    const messages = [{ content: 'Hello', role: 'user' as const }];

    beforeEach(() => {
      anthropicSpy = vi
        .spyOn(Anthropic.Messages.prototype, 'create')
        .mockResolvedValue(new ReadableStream() as any) as unknown as Mock;
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

    it.each(['gpt-6-luna', 'grok-4.7', 'gpt-5.4'])(
      'routes %s (@ai-sdk/openai) to the Responses endpoint',
      async (model) => {
        await new LobeOpenCodeZenAI({ apiKey: 'test' }).chat({ messages, model });

        expect(responsesCreateSpy).toHaveBeenCalledOnce();
        expect(chatCreateSpy).not.toHaveBeenCalled();
        expect(anthropicSpy).not.toHaveBeenCalled();
      },
    );

    it.each(['glm-5.3', 'kimi-k3', 'deepseek-v4-pro'])(
      'keeps %s (openai-compatible) on Chat Completions',
      async (model) => {
        await new LobeOpenCodeZenAI({ apiKey: 'test' }).chat({ messages, model });

        expect(chatCreateSpy).toHaveBeenCalledOnce();
        expect(responsesCreateSpy).not.toHaveBeenCalled();
        expect(anthropicSpy).not.toHaveBeenCalled();
      },
    );

    it.each(['claude-haiku-5-5', 'claude-opus-4-7', 'claude-sonnet-5-5'])(
      'routes %s (@ai-sdk/anthropic) through the Anthropic SDK',
      async (model) => {
        await new LobeOpenCodeZenAI({ apiKey: 'test' }).chat({ messages, model });

        expect(anthropicSpy).toHaveBeenCalledOnce();
        expect(chatCreateSpy).not.toHaveBeenCalled();
        expect(responsesCreateSpy).not.toHaveBeenCalled();
      },
    );

    it('lets an explicit per-model sdk override move the model to another protocol', async () => {
      // glm-5.3 ships as an openai-compatible model; the user pinned it to Responses.
      await new LobeOpenCodeZenAI({
        apiKey: 'test',
        modelSdkOverrides: { 'glm-5.3': 'openai-responses' },
      }).chat({ messages, model: 'glm-5.3' });

      expect(responsesCreateSpy).toHaveBeenCalledOnce();
      expect(chatCreateSpy).not.toHaveBeenCalled();
    });

    it('routes a saved provider sdk type without a user override', async () => {
      await new LobeOpenCodeZenAI({
        apiKey: 'test',
        modelSdkTypes: { 'glm-5.3': 'anthropic' },
      }).chat({ messages, model: 'glm-5.3' });

      expect(anthropicSpy).toHaveBeenCalledOnce();
    });

    it.each([
      ['none', 'none'],
      ['medium', 'medium'],
    ])('forwards MiMo thinking effort %s on the wire payload', async (effort, expected) => {
      await new LobeOpenCodeZenAI({ apiKey: 'test' }).chat({
        messages,
        model: 'mimo-v2.6-flash-free',
        reasoning_effort: effort as any,
      });

      expect(chatCreateSpy.mock.calls.at(-1)?.[0]).toMatchObject({ reasoning_effort: expected });
    });

    it('generates structured output on the protocol the model is routed to', async () => {
      responsesCreateSpy.mockResolvedValue({ output_text: '{"answer":"Hello"}' });
      const instance = new LobeOpenCodeZenAI({ apiKey: 'test' });

      const result = await instance.generateObject({
        messages,
        model: 'gpt-6-luna',
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
    expect(sanitizeJsonSchema(123)).toBe(123);
  });

  it('should remove null from enum arrays', () => {
    const input = {
      enum: ['apple', null, 'banana', null, 'cherry'],
      type: 'string',
    };
    expect(sanitizeJsonSchema(input)).toEqual({
      enum: ['apple', 'banana', 'cherry'],
      type: 'string',
    });
  });

  it('should simplify type: ["string", "null"] to type: "string"', () => {
    const input = {
      properties: {
        name: { type: ['string', 'null'] },
      },
      type: 'object',
    };
    expect(sanitizeJsonSchema(input)).toEqual({
      properties: {
        name: { type: 'string' },
      },
      type: 'object',
    });
  });

  it('should keep type: ["string", "number"] as array (no null)', () => {
    const input = {
      properties: {
        value: { type: ['string', 'number'] },
      },
      type: 'object',
    };
    expect(sanitizeJsonSchema(input)).toEqual({
      properties: {
        value: { type: ['string', 'number'] },
      },
      type: 'object',
    });
  });

  it('should drop enum key if all values are null', () => {
    const input = {
      enum: [null, null],
      type: 'string',
    };
    expect(sanitizeJsonSchema(input)).toEqual({
      type: 'string',
    });
  });

  it('should recurse into properties', () => {
    const input = {
      properties: {
        status: {
          enum: ['active', null, 'inactive'],
          type: ['string', 'null'],
        },
      },
      type: 'object',
    };
    expect(sanitizeJsonSchema(input)).toEqual({
      properties: {
        status: {
          enum: ['active', 'inactive'],
          type: 'string',
        },
      },
      type: 'object',
    });
  });

  it('should recurse into allOf/anyOf/oneOf', () => {
    const input = {
      anyOf: [
        { enum: ['a', null], type: 'string' },
        { enum: [null, 'b'], type: 'string' },
      ],
    };
    expect(sanitizeJsonSchema(input)).toEqual({
      anyOf: [
        { enum: ['a'], type: 'string' },
        { enum: ['b'], type: 'string' },
      ],
    });
  });

  it('should recurse into items and prefixItems', () => {
    const input = {
      items: {
        enum: ['x', null],
        type: 'string',
      },
      type: 'array',
    };
    expect(sanitizeJsonSchema(input)).toEqual({
      items: {
        enum: ['x'],
        type: 'string',
      },
      type: 'array',
    });
  });

  it('should handle deeply nested schemas with $defs and if/then/else', () => {
    const schema = {
      $defs: {
        Foo: {
          enum: ['ok', 'error', null],
        },
      },
      if: { properties: { x: { enum: ['a', null] } } },
      // `then` here is the JSON Schema if/then/else keyword, not a thenable.
      // eslint-disable-next-line unicorn/no-thenable
      then: { properties: { y: { type: ['string', 'null'] } } },
      else: { properties: { z: { enum: ['b', null] } } },
    };
    const result = sanitizeJsonSchema(schema);

    expect(result.$defs.Foo.enum).toEqual(['ok', 'error']);
    expect(result.if.properties.x.enum).toEqual(['a']);
    expect(result.then.properties.y.type).toBe('string');
    expect(result.else.properties.z.enum).toEqual(['b']);
  });

  it('should handle schemas without nullable enums (no-op)', () => {
    const input = {
      properties: {
        age: { type: 'number' },
        name: { type: 'string' },
      },
      required: ['name'],
      type: 'object',
    };
    expect(sanitizeJsonSchema(input)).toEqual(input);
  });
});

describe('buildResponsesPayload Kimi thinking semantics', () => {
  const conversation = [
    { content: 'Plan a feature', role: 'user' },
    { content: 'Sure, here is the plan', role: 'assistant' },
    { content: 'Looks good', role: 'user' },
  ];

  const findAssistantMessage = (payload: any) =>
    payload.messages.find((m: any) => m.role === 'assistant');

  describe('native-thinking K3 models (kimi-k3)', () => {
    it("should drop a saved thinking:disabled and keep reasoning_effort 'max' + forced reasoning_content", () => {
      const payload = buildResponsesPayload({
        messages: conversation,
        model: 'kimi-k3',
        thinking: { type: 'disabled' },
      } as any);

      expect('thinking' in payload).toBe(false);
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

  describe('MiMo effort routing', () => {
    it('keeps reasoning_effort none for MiMo models so thinking can be turned off', () => {
      const payload = buildResponsesPayload({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'mimo-v2.6-flash-free',
        reasoning_effort: 'none',
      } as any);

      expect(payload.reasoning_effort).toBe('none');
      expect('thinking' in payload).toBe(false);
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
