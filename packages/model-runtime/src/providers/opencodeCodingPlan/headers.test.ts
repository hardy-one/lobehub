// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LobeOpenCodeCodingPlanAI } from './index';

describe('OpenCode Go session headers', () => {
  const requests: { headers: Headers; url: string }[] = [];
  const messages = [{ content: 'Hello', role: 'user' as const }];
  const createRuntime = () => new LobeOpenCodeCodingPlanAI({ apiKey: 'test' });

  const chatCompletionBody = {
    choices: [
      {
        finish_reason: 'stop',
        index: 0,
        message: {
          content: '{"ok":true}',
          role: 'assistant',
          tool_calls: [
            {
              function: { arguments: '{"ok":true}', name: 'result' },
              id: 'tool-1',
              type: 'function',
            },
          ],
        },
      },
    ],
    created: 0,
    id: 'chatcmpl-test',
    model: 'test',
    object: 'chat.completion',
    usage: { completion_tokens: 1, prompt_tokens: 1, total_tokens: 2 },
  };

  const responsesBody = {
    created_at: 0,
    id: 'resp-test',
    model: 'test',
    object: 'response',
    output: [
      {
        content: [{ annotations: [], text: '{"ok":true}', type: 'output_text' }],
        id: 'msg-1',
        role: 'assistant',
        status: 'completed',
        type: 'message',
      },
      {
        arguments: '{"ok":true}',
        call_id: 'tool-1',
        id: 'fc-1',
        name: 'result',
        status: 'completed',
        type: 'function_call',
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

  const anthropicBody = {
    content: [{ text: '{"ok":true}', type: 'text' }],
    id: 'msg-test',
    model: 'test',
    role: 'assistant',
    stop_reason: 'end_turn',
    type: 'message',
    usage: { input_tokens: 1, output_tokens: 1 },
  };

  beforeEach(() => {
    requests.length = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const target = String(url);
        if (target === 'https://models.dev/api.json') {
          return Response.json({ 'opencode-go': { models: {} } });
        }

        requests.push({ headers: new Headers(init?.headers), url: target });

        if (target.endsWith('/responses')) return Response.json(responsesBody);
        if (target.endsWith('/messages')) return Response.json(anthropicBody);

        return Response.json(chatCompletionBody);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    // openai-compatible models stay on the gateway's Chat Completions endpoint
    ['glm-5.3', '/chat/completions'],
    ['deepseek-v4-pro', '/chat/completions'],
    ['mimo-v2.6-pro', '/chat/completions'],
    // @ai-sdk/openai models are served by the Responses endpoint
    ['gpt-6-luna', '/responses'],
    ['grok-4.7', '/responses'],
    // @ai-sdk/anthropic models go to the Anthropic Messages endpoint
    ['qwen3.8-max', '/messages'],
  ])('preserves conversation affinity across runtime instances for %s', async (model, endpoint) => {
    for (const topicId of ['topic-a', 'topic-a', 'topic-b']) {
      const response = await createRuntime().chat(
        { messages, model, stream: false },
        {
          metadata: { topicId },
          requestHeaders: { 'x-custom': 'preserved' },
        },
      );
      await response.text();
    }

    expect(requests).toHaveLength(3);
    expect(requests.map(({ headers }) => headers.get('x-opencode-session'))).toEqual([
      'topic-a',
      'topic-a',
      'topic-b',
    ]);
    for (const { headers, url } of requests) {
      expect(url).toBe(`https://opencode.ai/zen/go/v1${endpoint}`);
      expect(headers.get('x-opencode-client')).toBe('lobehub');
      expect(headers.get('user-agent')).toBe('lobehub');
      expect(headers.get('x-custom')).toBe('preserved');
    }
  });

  it.each([
    ['glm-5.3', '/chat/completions'],
    ['gpt-6-luna', '/responses'],
  ])('sends session headers for %s structured output', async (model, endpoint) => {
    const result = await createRuntime().generateObject(
      {
        messages,
        model,
        schema: {
          name: 'result',
          schema: { properties: { ok: { type: 'boolean' } }, type: 'object' },
        },
      },
      { metadata: { topicId: 'topic-object' } },
    );

    expect(result).toEqual({ ok: true });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe(`https://opencode.ai/zen/go/v1${endpoint}`);
    expect(requests[0].headers.get('x-opencode-session')).toBe('topic-object');
    expect(requests[0].headers.get('x-opencode-client')).toBe('lobehub');
  });

  it('reuses a topicless task ID across chat and structured output', async () => {
    for (const taskId of ['task-1', 'task-1', 'task-2']) {
      const runtime = createRuntime();
      const response = await runtime.chat(
        { messages, model: 'glm-5.3', stream: false },
        { metadata: { taskId } },
      );
      await response.text();
      await runtime.generateObject(
        {
          messages,
          model: 'glm-5.3',
          schema: {
            name: 'result',
            schema: { properties: { ok: { type: 'boolean' } }, type: 'object' },
          },
        },
        { metadata: { taskId } },
      );
    }

    expect(requests.map(({ headers }) => headers.get('x-opencode-session'))).toEqual([
      'task-1',
      'task-1',
      'task-1',
      'task-1',
      'task-2',
      'task-2',
    ]);
  });

  it('prefers the topic over a task ID', async () => {
    const response = await createRuntime().chat(
      { messages, model: 'glm-5.3', stream: false },
      { metadata: { taskId: 'task-1', topicId: 'topic-1' } },
    );
    await response.text();

    expect(requests[0].headers.get('x-opencode-session')).toBe('topic-1');
  });

  it('assigns separate UUIDs to standalone requests without a topic or task', async () => {
    const runtime = createRuntime();
    for (let i = 0; i < 2; i++) {
      const response = await runtime.chat({ messages, model: 'glm-5.3', stream: false });
      await response.text();
    }
    const ids = requests.map(({ headers }) => headers.get('x-opencode-session'));
    for (const id of ids)
      expect(id).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
    expect(ids[0]).not.toBe(ids[1]);
  });
});
