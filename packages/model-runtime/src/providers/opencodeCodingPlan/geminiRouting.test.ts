// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LobeOpenCodeCodingPlanAI } from './index';

const GO_BASE_URL = 'https://opencode.ai/zen/go/v1';
/** The gateway serves the native Gemini protocol from its own family prefix. */
const GO_GEMINI_BASE_URL = 'https://opencode.ai/inference/go/google';

interface CapturedRequest {
  body: any;
  headers: Record<string, string>;
  method: string;
  url: string;
}

const messages = [{ content: 'Hi there', role: 'user' as const }];

const geminiSSE = [
  'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}],"role":"model"},"index":0}],"usageMetadata":{"promptTokenCount":3,"totalTokenCount":5}}',
  '',
  'data: {"candidates":[{"content":{"parts":[{"text":" world"}],"role":"model"},"finishReason":"STOP","index":0}],"usageMetadata":{"candidatesTokenCount":2,"promptTokenCount":3,"totalTokenCount":5}}',
  '',
  '',
].join('\n');

const chatCompletionBody = {
  choices: [{ finish_reason: 'stop', index: 0, message: { content: 'ok', role: 'assistant' } }],
  created: 0,
  id: 'chatcmpl-test',
  model: 'test',
  object: 'chat.completion',
  usage: { completion_tokens: 1, prompt_tokens: 1, total_tokens: 2 },
};

const anthropicBody = {
  content: [{ text: 'ok', type: 'text' }],
  id: 'msg-test',
  model: 'test',
  role: 'assistant',
  stop_reason: 'end_turn',
  type: 'message',
  usage: { input_tokens: 1, output_tokens: 1 },
};

const responsesBody = {
  created_at: 0,
  id: 'resp-test',
  model: 'test',
  object: 'response',
  output: [
    {
      content: [{ annotations: [], text: 'ok', type: 'output_text' }],
      id: 'msg-1',
      role: 'assistant',
      status: 'completed',
      type: 'message',
    },
  ],
  parallel_tool_calls: false,
  status: 'completed',
  tool_choice: 'auto',
  tools: [],
  usage: {
    input_tokens: 1,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: 1,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: 2,
  },
};

const captureRequest = (init?: RequestInit) => ({
  body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
  headers: Object.fromEntries(new Headers(init?.headers as HeadersInit).entries()),
  method: init?.method ?? 'GET',
  url: '',
});

describe('OpenCode Go Gemini routing', () => {
  let captured: CapturedRequest[] = [];

  const stubFetch = () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const target = String(url);
        // Route resolution reads models.dev; keep the routing metadata cache quiet.
        if (target === 'https://models.dev/api.json')
          return Response.json({ opencode: { models: {} } });

        captured.push({ ...captureRequest(init), url: target });

        if (target.includes(':streamGenerateContent')) {
          return new Response(geminiSSE, { headers: { 'content-type': 'text/event-stream' } });
        }
        if (target.endsWith('/responses')) return Response.json(responsesBody);
        if (target.endsWith('/messages')) return Response.json(anthropicBody);

        return Response.json(chatCompletionBody);
      }),
    );
  };

  beforeEach(() => {
    captured = [];
    stubFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends a Gemini model to the native Google surface of the gateway', async () => {
    const response = await new LobeOpenCodeCodingPlanAI({ apiKey: 'test-key' }).chat(
      { messages, model: 'gemini-4-argon-contributor', stream: true },
      { metadata: { topicId: 'topic-gemini' } },
    );
    const text = await response.text();

    expect(captured).toHaveLength(1);
    const [request] = captured;

    // Full URL: family prefix + SDK-appended /v1beta/models/{model}:streamGenerateContent
    expect(request.url).toBe(
      `${GO_GEMINI_BASE_URL}/v1beta/models/gemini-4-argon-contributor:streamGenerateContent?alt=sse`,
    );
    expect(request.method).toBe('POST');

    // Request body carries the model-agnostic Gemini payload with the user turn.
    expect(request.body.contents).toEqual([
      expect.objectContaining({
        parts: [expect.objectContaining({ text: 'Hi there' })],
        role: 'user',
      }),
    ]);

    // The gateway identifies a conversation by these headers; Go rejects requests without them.
    expect(request.headers['x-opencode-session']).toBe('topic-gemini');
    expect(request.headers['x-opencode-client']).toBe('lobehub');
    expect(request.headers['user-agent']).toBe('lobehub');
    expect(request.headers['x-goog-api-key']).toBe('test-key');

    // Streaming chunks are parsed into the provider stream, not dropped.
    expect(text).toContain('Hello');
    expect(text).toContain(' world');
    expect(text).toContain('event: stop');
  });

  it('keeps the Gemini family prefix when a proxied gateway base URL is configured', async () => {
    await new LobeOpenCodeCodingPlanAI({
      apiKey: 'test-key',
      baseURL: 'https://proxy.example.com/zen/go/v1',
    }).chat(
      { messages, model: 'gemini-4-argon-contributor' },
      { metadata: { topicId: 'topic-proxy' } },
    );

    expect(captured[0].url).toBe(
      'https://proxy.example.com/inference/go/google/v1beta/models/gemini-4-argon-contributor:streamGenerateContent?alt=sse',
    );
  });

  it('keeps a base URL that already points at the Gemini surface', async () => {
    await new LobeOpenCodeCodingPlanAI({
      apiKey: 'test-key',
      baseURL: 'https://proxy.example.com/inference/go/google',
    }).chat(
      { messages, model: 'gemini-4-argon-contributor' },
      { metadata: { topicId: 'topic-direct' } },
    );

    expect(captured[0].url).toBe(
      'https://proxy.example.com/inference/go/google/v1beta/models/gemini-4-argon-contributor:streamGenerateContent?alt=sse',
    );
  });

  it.each([
    // openai-compatible models stay on the gateway's Chat Completions endpoint
    ['glm-5.3', `${GO_BASE_URL}/chat/completions`],
    // @ai-sdk/openai models are served by the Responses endpoint
    ['gpt-6-luna', `${GO_BASE_URL}/responses`],
    // @ai-sdk/anthropic models go to the Anthropic Messages endpoint
    ['claude-haiku-5-5', `${GO_BASE_URL}/messages`],
  ])('leaves the %s route at %s', async (model, expectedURL) => {
    const response = await new LobeOpenCodeCodingPlanAI({ apiKey: 'test-key' }).chat(
      { messages, model, stream: false },
      { metadata: { topicId: 'topic-other' } },
    );
    await response.text();

    expect(captured[0].url).toBe(expectedURL);
    expect(captured[0].headers['x-opencode-session']).toBe('topic-other');
  });
});
