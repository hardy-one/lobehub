// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetModelsDevCacheForTests,
  enrichWithModelsDev,
  fetchModelsDevApi,
  fetchModelsDevRoutingMetadata,
  mapReasoningOptionsToExtendParams,
  MODELS_DEV_COLD_BUDGET_MS,
  MODELS_DEV_TIMEOUT_MS,
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

  it('maps low/high/max sets without medium to the DeepSeek V4 GA effort control', () => {
    // The generic reasoningEffort slider only offers low/medium/high and cannot
    // express 'max'; deepseekV4GAReasoningEffort covers none/low/high/max.
    expect(
      mapReasoningOptionsToExtendParams('x-preview-f-free', [
        { type: 'effort', values: ['low', 'high', 'max'] },
      ]),
    ).toEqual(['deepseekV4GAReasoningEffort']);
    expect(
      mapReasoningOptionsToExtendParams('x-preview-f-free', [
        { type: 'effort', values: ['none', 'low', 'high', 'max'] },
      ]),
    ).toEqual(['deepseekV4GAReasoningEffort']);
  });

  it('gives the multi-MB api.json download enough time before aborting', () => {
    // Measured ~4MB payload taking 3.5-5s on consumer links; a tighter timeout
    // aborts every cold fetch and silently degrades enrichment to bare ids.
    expect(MODELS_DEV_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000);
  });
});

describe('protocol enrichment', () => {
  it.each([
    ['@ai-sdk/openai', 'openai-responses'],
    ['@ai-sdk/openai-compatible', 'openai'],
    ['@ai-sdk/anthropic', 'anthropic'],
    ['@ai-sdk/google', 'google'],
  ])('preserves protocol meaning for %s', (npm, sdkType) => {
    expect(enrichWithModelsDev('same-model', { id: 'same-model', provider: { npm } }).sdkType).toBe(
      sdkType,
    );
  });
  it('inherits the provider protocol only when the exact model does not declare one', () => {
    expect(
      enrichWithModelsDev('same', { id: 'same' }, undefined, '@ai-sdk/openai-compatible').sdkType,
    ).toBe('openai');
    expect(
      enrichWithModelsDev(
        'same',
        { id: 'same', provider: { npm: '@ai-sdk/anthropic' } },
        undefined,
        '@ai-sdk/openai-compatible',
      ).sdkType,
    ).toBe('anthropic');
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
    // The curated bank entry wins over the models.dev heuristic for a known id.
    expect(result[0].settings?.extendParams).toEqual(['enableReasoning']);
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
      providerId: 'volcenginecodingplan',
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

describe('models.dev cold-cache first response', () => {
  const bankModels = [{ id: 'bank-a', settings: { extendParams: ['enableReasoning'] } }];
  const catalog = {
    opencode: {
      models: {
        'bank-a': {
          id: 'bank-a',
          name: 'Bank A',
          reasoning: true,
          limit: { context: 200_000, output: 8_192 },
        },
      },
    },
  };

  const resolveZen = (client?: any) =>
    resolveModelsDevModelList({
      bankModels,
      client,
      modelsDevProvider: 'opencode',
      providerId: 'opencodezen',
    });

  beforeEach(() => {
    __resetModelsDevCacheForTests();
  });

  afterEach(() => {
    __resetModelsDevCacheForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('bounds the first response when models.dev never answers', async () => {
    // An unreachable models.dev used to block the whole list for
    // MODELS_DEV_TIMEOUT_MS (12s, measured 12009ms before this change).
    expect(MODELS_DEV_COLD_BUDGET_MS).toBeLessThan(1000);
    vi.useFakeTimers();
    const hangingFetch = vi.fn(() => new Promise(() => {}));
    global.fetch = hangingFetch as any;

    const pending = resolveZen();
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(MODELS_DEV_COLD_BUDGET_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await expect(pending).resolves.toEqual([
      { id: 'bank-a', settings: { extendParams: ['enableReasoning'] } },
    ]);
    expect(hangingFetch).toHaveBeenCalledOnce();
  });

  it('returns the local list quickly when the cold request is rejected', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed')) as any;

    const startedAt = performance.now();
    const result = await resolveZen();
    const elapsed = performance.now() - startedAt;

    expect(result).toEqual([{ id: 'bank-a', settings: { extendParams: ['enableReasoning'] } }]);
    expect(elapsed).toBeLessThan(MODELS_DEV_COLD_BUDGET_MS + 500);
    expect(global.fetch).toHaveBeenCalledOnce();
  });

  it.each([
    ['an HTTP error', { ok: false, status: 503 }],
    [
      'a body that is not the catalog',
      {
        ok: true,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON at position 0');
        },
      },
    ],
  ])('returns the local list quickly on %s', async (_label, response) => {
    global.fetch = vi.fn().mockResolvedValue(response) as any;

    const startedAt = performance.now();
    const result = await resolveZen();
    const elapsed = performance.now() - startedAt;

    expect(result).toEqual([{ id: 'bank-a', settings: { extendParams: ['enableReasoning'] } }]);
    expect(elapsed).toBeLessThan(MODELS_DEV_COLD_BUDGET_MS + 500);
  });

  it('serves a warm catalog without another request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => catalog });
    global.fetch = fetchMock as any;

    const cold = await resolveZen();
    expect(cold[0].displayName).toBe('Bank A');

    const startedAt = performance.now();
    const warm = await resolveZen();
    const elapsed = performance.now() - startedAt;

    expect(elapsed).toBeLessThan(MODELS_DEV_COLD_BUDGET_MS);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(warm[0]).toMatchObject({ displayName: 'Bank A', contextWindowTokens: 200_000 });
  });

  it('picks up the background refresh on the next call', async () => {
    const pending: Array<(value: any) => void> = [];
    const fetchMock = vi.fn(
      () => new Promise((resolve) => pending.push(resolve as (value: any) => void)),
    );
    global.fetch = fetchMock as any;

    const cold = await resolveZen();
    // Bank-only metadata: the first response no longer waits for the download.
    expect(cold[0].displayName).toBeUndefined();

    pending[0]({ ok: true, json: async () => catalog });
    await fetchModelsDevApi();

    const warm = await resolveZen();
    expect(warm[0]).toMatchObject({ displayName: 'Bank A', contextWindowTokens: 200_000 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('retries on the next call after the network recovers', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce({ ok: true, json: async () => catalog });
    global.fetch = fetchMock as any;

    await resolveZen();
    // The failure cooldown protects a catalog we already have; with nothing cached
    // the next request must be able to pick the recovered network up immediately.
    const recovered = await resolveZen();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(recovered[0]).toMatchObject({ displayName: 'Bank A', contextWindowTokens: 200_000 });
  });

  it('keeps the Zen and Go catalogs isolated', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        opencode: {
          models: {
            'bank-a': { id: 'bank-a', name: 'Zen Only', limit: { context: 111_111 } },
          },
        },
      }),
    }) as any;
    await fetchModelsDevApi();

    const go = await resolveModelsDevModelList({
      bankModels: [{ id: 'bank-a' }],
      modelsDevProvider: 'opencode-go',
      providerId: 'opencodecodingplan',
    });
    expect(go).toEqual([{ id: 'bank-a' }]);

    const zen = await resolveModelsDevModelList({
      bankModels: [{ id: 'bank-a' }],
      modelsDevProvider: 'opencode',
      providerId: 'opencodezen',
    });
    expect(zen[0]).toMatchObject({ displayName: 'Zen Only', contextWindowTokens: 111_111 });
  });
});
