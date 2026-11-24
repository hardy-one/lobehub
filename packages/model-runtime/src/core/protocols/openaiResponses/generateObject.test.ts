// @vitest-environment node
import type OpenAI from 'openai';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createOpenAICompatibleRuntime } from '../../openaiCompatible';
import {
  generateObjectViaResponses,
  generateToolCallsViaResponses,
  getGenerateObjectResponsesReasoningParams,
} from './generateObject';

vi.mock('../../../utils/getModelPricing', () => ({
  getModelPricing: vi.fn().mockResolvedValue(undefined),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

const payload = {
  messages: [{ content: 'Write the persona', role: 'user' as const }],
  model: 'gpt-test',
  tools: [{ function: { name: 'commit_user_persona', parameters: {} }, type: 'function' as const }],
};

const toolCallOk = {
  output: [{ arguments: '{"persona":"done"}', name: 'commit_user_persona', type: 'function_call' }],
  status: 'completed',
};

describe('generateObjectViaResponses', () => {
  it('returns valid structured output after one request', async () => {
    const instance = new (createOpenAICompatibleRuntime({
      baseURL: 'https://api.test.com/v1',
      provider: 'testprovider',
    }))({ apiKey: 'test' });
    const createMock = vi
      .spyOn(instance.client.responses, 'create')
      .mockResolvedValue({ output_text: '{"persona":"done"}' } as any);
    const runtime = instance as any;
    const schema = {
      name: 'persona',
      schema: { properties: { persona: { type: 'string' } }, type: 'object' as const },
    };

    const result = await generateObjectViaResponses(
      runtime,
      {},
      { ...payload, schema },
      schema,
      undefined,
      { model: payload.model, provider: 'testprovider' },
      vi.fn() as any,
    );

    expect(result).toEqual({ persona: 'done' });
    expect(createMock).toHaveBeenCalledTimes(1);
  });
});

describe('generateToolCallsViaResponses', () => {
  const invoke = (response: unknown) => {
    const instance = new (createOpenAICompatibleRuntime({
      baseURL: 'https://api.test.com/v1',
      provider: 'testprovider',
    }))({ apiKey: 'test' });
    const createMock = vi
      .spyOn(instance.client.responses, 'create')
      .mockResolvedValue(response as any);
    const promise = generateToolCallsViaResponses(
      instance as any,
      {},
      payload,
      undefined,
      undefined,
      vi.fn() as any,
    );
    return { createMock, promise };
  };

  it('returns valid tool calls after one request', async () => {
    const { createMock, promise } = invoke(toolCallOk);

    await expect(promise).resolves.toEqual([
      { arguments: { persona: 'done' }, name: 'commit_user_persona' },
    ]);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('recovers a trailing extra brace after one request', async () => {
    const { createMock, promise } = invoke({
      output: [
        { arguments: '{"persona":"done"}}', name: 'commit_user_persona', type: 'function_call' },
      ],
      status: 'completed',
    });

    await expect(promise).resolves.toEqual([
      { arguments: { persona: 'done' }, name: 'commit_user_persona' },
    ]);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('throws on the first response without tool calls and preserves diagnostics', async () => {
    const response = {
      id: 'resp_1',
      output: [{ type: 'message' }],
      status: 'completed',
    } as OpenAI.Responses.Response;
    const { createMock, promise } = invoke(response);

    await expect(promise).rejects.toMatchObject({
      context: {
        model: payload.model,
        outputTypes: ['message'],
        provider: 'testprovider',
        responseId: 'resp_1',
        status: 'completed',
      },
      reason: 'no tool calls returned',
    });
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('throws on the first invalid JSON tool call with parser diagnostics', async () => {
    const args = '{"persona":"TOP_SECRET_RESPONSES", "broken"';
    const { createMock, promise } = invoke({
      incomplete_details: { reason: 'max_output_tokens' },
      output: [{ arguments: args, name: 'commit_user_persona', type: 'function_call' }],
      status: 'incomplete',
    });

    const error = await promise.catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      context: {
        argumentsLength: args.length,
        finishReason: 'incomplete',
        incompleteReason: 'max_output_tokens',
        truncated: true,
      },
      reason: 'invalid JSON in tool arguments',
    });
    expect((error as any).context.jsonErrorMessage).toEqual(expect.any(String));
    expect((error as any).context.jsonErrorSnippet).toContain('TOP_SECRET_RESPONSES');
    expect((error as any).context).not.toHaveProperty('attempts');
    expect(createMock).toHaveBeenCalledTimes(1);
  });
});

describe('getGenerateObjectResponsesReasoningParams', () => {
  // GPT-6.1 Terra accepts the none effort; GPT-6.1 Sol rejects it, so the API default stays.
  it.each([
    ['gpt-6.1-terra', { reasoning: { effort: 'none' } }],
    ['gpt-6.1-sol', {}],
  ])('maps disabled thinking for %s', (model, expected) => {
    const thinking = { budget_tokens: 0, type: 'disabled' as const };

    expect(getGenerateObjectResponsesReasoningParams({ model, thinking })).toEqual(expected);
  });
});
