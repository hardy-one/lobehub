// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetModelsDevCacheForTests,
  enrichWithModelsDev,
  fetchModelsDevApi,
  fetchModelsDevRoutingMetadata,
  mapReasoningOptionsToExtendParams,
  resolveModelsDevModelList,
} from './modelsDev';

vi.mock('../../utils/modelParse', () => ({
  processMultiProviderModelList: vi.fn(async (list: Array<Record<string, unknown>>) =>
    list.map((m) => ({ ...m })),
  ),
}));

describe('mapReasoningOptionsToExtendParams', () => {
  it('maps toggle / budget / effort sets', () => {
    expect(mapReasoningOptionsToExtendParams('x', [{ type: 'toggle' }])).toEqual([
      'enableReasoning',
    ]);
    expect(
      mapReasoningOptionsToExtendParams('glm-5.2', [{ type: 'effort', values: ['high', 'max'] }]),
    ).toEqual(['glm5_2ReasoningEffort']);
    expect(
      mapReasoningOptionsToExtendParams('step-3.5-flash', [
        { type: 'effort', values: ['low', 'high'] },
      ]),
    ).toEqual(['step3_5ReasoningEffort']);
  });

  it('maps provider-specific effort sets', () => {
    expect(
      mapReasoningOptionsToExtendParams('claude-opus-4-8', [
        { type: 'effort', values: ['low', 'medium', 'high', 'xhigh', 'max'] },
      ]),
    ).toEqual(['enableAdaptiveThinking', 'opus47Effort']);
    expect(
      mapReasoningOptionsToExtendParams('gpt-5.6-sol', [
        { type: 'effort', values: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] },
      ]),
    ).toEqual(['gpt5_6ReasoningEffort']);
    expect(
      mapReasoningOptionsToExtendParams('deepseek-v4-pro', [
        { type: 'toggle' },
        { type: 'effort', values: ['high', 'max'] },
      ]),
    ).toEqual(['deepseekV4ReasoningEffort']);
    expect(
      mapReasoningOptionsToExtendParams('grok-4.3', [
        { type: 'effort', values: ['low', 'medium', 'high'] },
      ]),
    ).toEqual(['grok4_3ReasoningEffort']);
  });

  it('maps min-only budgets and always-on reasoning', () => {
    expect(
      mapReasoningOptionsToExtendParams('claude-sonnet-4-6', [
        { type: 'budget_tokens', min: 1024 },
      ]),
    ).toEqual(['enableReasoning', 'reasoningBudgetToken']);
    expect(
      mapReasoningOptionsToExtendParams('kimi-k3', [{ type: 'effort', values: ['max'] }]),
    ).toBeUndefined();
  });
});

describe('fetchModelsDevRoutingMetadata', () => {
  beforeEach(() => {
    __resetModelsDevCacheForTests();
  });

  afterEach(() => {
    __resetModelsDevCacheForTests();
  });

  it('derives Anthropic and interleaved model ids from the shared catalog', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        opencode: {
          npm: '@ai-sdk/openai-compatible',
          models: {
            claude: {
              id: 'claude',
              interleaved: { field: 'reasoning_content' },
              provider: { npm: '@ai-sdk/anthropic' },
            },
            compatible: { id: 'compatible' },
            gpt: { id: 'gpt', provider: { npm: '@ai-sdk/openai' } },
            qwen: { id: 'qwen', provider: { npm: '@ai-sdk/anthropic' } },
          },
        },
      }),
    }) as any;

    const metadata = await fetchModelsDevRoutingMetadata('opencode');

    expect(metadata.available).toBe(true);
    expect(metadata.interleavedModelIds).toEqual(new Set(['claude']));
    expect(metadata.modelIdsBySdk).toEqual({
      '@ai-sdk/anthropic': ['claude', 'qwen'],
      '@ai-sdk/openai': ['gpt'],
      '@ai-sdk/openai-compatible': ['compatible'],
    });
  });
});

describe('models.dev cache', () => {
  beforeEach(() => {
    __resetModelsDevCacheForTests();
  });

  afterEach(() => {
    __resetModelsDevCacheForTests();
    vi.useRealTimers();
  });

  it('keeps stale metadata during a failed refresh and retries after the cooldown', async () => {
    vi.useFakeTimers();
    const initialCatalog = { opencode: { models: { first: { id: 'first' } } } };
    const refreshedCatalog = { opencode: { models: { second: { id: 'second' } } } };
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => initialCatalog })
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce({ ok: true, json: async () => refreshedCatalog }) as any;

    await expect(fetchModelsDevApi()).resolves.toEqual(initialCatalog);

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);
    await expect(fetchModelsDevApi()).resolves.toEqual(initialCatalog);
    expect(global.fetch).toHaveBeenCalledTimes(2);

    await expect(fetchModelsDevApi()).resolves.toEqual(initialCatalog);
    expect(global.fetch).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(30 * 1000 + 1);
    await expect(fetchModelsDevApi()).resolves.toEqual(refreshedCatalog);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('populates a cold models.dev cache before enriching the fetched list', async () => {
    // Regression: on a cold cache the first fetch used to resolve with bare ids —
    // no displayName / contextWindowTokens / pricing from models.dev.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        opencode: {
          models: {
            'muse-spark-1.2-contributor-free': {
              id: 'muse-spark-1.2-contributor-free',
              name: 'Muse Spark 1.2 Free',
              reasoning: true,
              tool_call: true,
              limit: { context: 1_048_576, output: 131_072 },
            },
          },
        },
      }),
    }) as any;

    const client = {
      models: {
        list: vi.fn().mockResolvedValue({
          data: [{ id: 'muse-spark-1.2-contributor-free' }],
        }),
      },
    };

    const result = await resolveModelsDevModelList({
      bankModels: [],
      client,
      modelsDevProvider: 'opencode',
      providerId: 'opencodezen',
    });

    expect(client.models.list).toHaveBeenCalledOnce();
    expect(result[0]).toMatchObject({
      id: 'muse-spark-1.2-contributor-free',
      displayName: 'Muse Spark 1.2 Free',
      contextWindowTokens: 1_048_576,
      maxOutput: 131_072,
      reasoning: true,
      functionCall: true,
    });
  });

  it('still resolves from the bank when the cold models.dev fetch fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network unavailable')) as any;

    const client = { models: { list: vi.fn().mockResolvedValue({ data: [{ id: 'model-a' }] }) } };

    const result = await resolveModelsDevModelList({
      bankModels: [{ id: 'model-a', settings: { extendParams: ['enableReasoning'] } }],
      client,
      modelsDevProvider: 'opencode',
      providerId: 'opencodezen',
    });

    expect(result).toEqual([{ id: 'model-a', settings: { extendParams: ['enableReasoning'] } }]);
    expect(client.models.list).toHaveBeenCalledOnce();
    expect(global.fetch).toHaveBeenCalledOnce();
  });
});

describe('enrichWithModelsDev', () => {
  it('prefers models.dev extendParams over empty bank', () => {
    const result = enrichWithModelsDev('glm-5.1', {
      id: 'glm-5.1',
      name: 'GLM-5.1',
      reasoning: true,
      tool_call: true,
      reasoning_options: [{ type: 'toggle' }],
      limit: { context: 200_000, output: 131_072 },
    });
    expect(result.displayName).toBe('GLM-5.1');
    expect(result.contextWindowTokens).toBe(200_000);
    expect(result.settings?.extendParams).toEqual(['enableReasoning']);
  });
});

describe('resolveModelsDevModelList', () => {
  beforeEach(() => {
    __resetModelsDevCacheForTests();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    __resetModelsDevCacheForTests();
  });

  it('uses API list when available and enriches from models.dev', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        'zhipuai-coding-plan': {
          models: {
            'glm-5.2': {
              id: 'glm-5.2',
              name: 'GLM-5.2',
              reasoning: true,
              tool_call: true,
              reasoning_options: [{ type: 'effort', values: ['high', 'max'] }],
              limit: { context: 1_000_000, output: 131_072 },
            },
          },
        },
      }),
    }) as any;

    await fetchModelsDevRoutingMetadata('zhipuai-coding-plan');

    const client = {
      models: {
        list: vi.fn().mockResolvedValue({ data: [{ id: 'glm-5.2' }] }),
      },
    };

    const result = await resolveModelsDevModelList({
      bankModels: [{ id: 'glm-5.2', settings: { extendParams: ['enableReasoning'] } }],
      client,
      modelsDevProvider: 'zhipuai-coding-plan',
      providerId: 'glmcodingplan',
    });

    expect(client.models.list).toHaveBeenCalled();
    expect(result[0].id).toBe('glm-5.2');
    expect(result[0].settings?.extendParams).toEqual(['glm5_2ReasoningEffort']);
  });

  it('falls back to the static bank when the official API fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        'stepfun-step-plan': {
          models: {
            'step-3.7-flash': {
              id: 'step-3.7-flash',
              name: 'Step 3.7 Flash',
              reasoning: true,
              tool_call: true,
              reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high'] }],
              limit: { context: 256_000, output: 256_000 },
            },
            'old-model': {
              id: 'old-model',
              name: 'Old',
            },
          },
        },
      }),
    }) as any;

    await fetchModelsDevRoutingMetadata('stepfun-step-plan');

    const client = {
      models: {
        list: vi.fn().mockRejectedValue(new Error('no api')),
      },
    };

    const result = await resolveModelsDevModelList({
      bankModels: [{ id: 'step-3.7-flash' }],
      client,
      modelsDevProvider: 'stepfun-step-plan',
      providerId: 'stepfuncodingplan',
    });

    expect(result.map((m: any) => m.id)).toEqual(['step-3.7-flash']);
    expect(result[0].settings?.extendParams).toEqual(['reasoningEffort']);
  });

  it('uses bank order when the official API returns an empty list', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        'alibaba-coding-plan-cn': {
          models: {
            'qwen3.7-plus': { id: 'qwen3.7-plus', name: 'Qwen3.7 Plus', tool_call: true },
            'extra-model': { id: 'extra-model', name: 'Extra', tool_call: true },
            'glm-5': {
              id: 'glm-5',
              name: 'GLM-5',
              tool_call: true,
              reasoning_options: [{ type: 'toggle' }],
            },
          },
        },
      }),
    }) as any;

    await fetchModelsDevRoutingMetadata('alibaba-coding-plan-cn');

    const result = await resolveModelsDevModelList({
      bankModels: [
        { id: 'qwen3.7-plus' },
        { id: 'glm-5', settings: { extendParams: ['enableReasoning'] } },
      ],
      client: { models: { list: vi.fn().mockResolvedValue({ data: [] }) } },
      modelsDevProvider: 'alibaba-coding-plan-cn',
      providerId: 'bailiancodingplan',
    });

    expect(result.map((m: any) => m.id)).toEqual(['qwen3.7-plus', 'glm-5']);
  });
});
