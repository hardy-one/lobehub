import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  appendSubAgentModelGuidanceToCallSubAgentTool,
  clearSubAgentModelAvailabilityCache,
  formatSubAgentModelGuidance,
  MAX_LISTED_MODELS_PER_PROVIDER,
  MAX_LISTED_MODELS_TOTAL,
  SUB_AGENT_MODEL_GUIDANCE_TTL_MS,
} from '../subAgentModelGuidance';

const mockGetAllModels = vi.fn();
const mockGetAiProviderList = vi.fn();

vi.mock('@/database/models/aiModel', () => ({
  AiModelModel: vi.fn().mockImplementation(() => ({
    getAllModels: mockGetAllModels,
  })),
}));

vi.mock('@/database/models/aiProvider', () => ({
  AiProviderModel: vi.fn().mockImplementation(() => ({
    getAiProviderList: mockGetAiProviderList,
  })),
}));

describe('formatSubAgentModelGuidance', () => {
  it('groups models by provider, sorts providers and models, and drops non-chat / disabled models', () => {
    const text = formatSubAgentModelGuidance([
      { id: 'glm-4.7', providerId: 'opencodecodingplan', enabled: true, type: 'chat' },
      { id: 'gpt-5.6-terra', providerId: 'openai', enabled: true, type: 'chat' },
      { id: 'gpt-5.6-sol', providerId: 'openai', enabled: true, type: 'chat' },
      { id: 'text-embedding-3-small', providerId: 'openai', enabled: true, type: 'embedding' },
      { id: 'disabled-model', providerId: 'openai', enabled: false, type: 'chat' },
    ]);

    expect(text).toBe(
      [
        'callSubAgent valid models (model paired with its exact provider):',
        '"openai": {"gpt-5.6-sol", "gpt-5.6-terra"}',
        '"opencodecodingplan": {"glm-4.7"}',
      ].join('\n'),
    );
  });

  it('returns undefined when there are no enabled chat models', () => {
    expect(
      formatSubAgentModelGuidance([
        { id: 'embed', providerId: 'openai', enabled: true, type: 'embedding' },
        { id: 'disabled', providerId: 'openai', enabled: false, type: 'chat' },
      ]),
    ).toBeUndefined();
  });

  it('caps the listed models per provider after sorting', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      id: `model-${String(i).padStart(2, '0')}`,
      providerId: 'openai',
      enabled: true,
      type: 'chat',
    }));

    const text = formatSubAgentModelGuidance(many)!;

    expect(text).toContain('"model-00"');
    expect(text).toContain(
      `"model-${String(MAX_LISTED_MODELS_PER_PROVIDER - 1).padStart(2, '0')}"`,
    );
    expect(text).not.toContain(
      `"model-${String(MAX_LISTED_MODELS_PER_PROVIDER).padStart(2, '0')}"`,
    );
    // Per-provider cap alone does not trip the total truncation note.
    expect(text).not.toContain('truncated');
  });

  it('caps the total number of listed models across providers and notes the truncation', () => {
    const providers = ['alpha', 'beta', 'gamma', 'delta'];
    const models = providers.flatMap((providerId) =>
      Array.from({ length: MAX_LISTED_MODELS_PER_PROVIDER }, (_, i) => ({
        id: `${providerId}-model-${String(i).padStart(2, '0')}`,
        providerId,
        enabled: true,
        type: 'chat',
      })),
    );

    const text = formatSubAgentModelGuidance(models)!;

    // Deterministic fill in sorted-provider order: alpha/beta/delta take 30
    // each (90), gamma gets the remaining 10.
    expect(text).toContain('"alpha"');
    expect(text).toContain('"beta"');
    expect(text).toContain('"delta"');
    expect(text).toContain('"gamma": {"gamma-model-00"');
    expect(text).not.toContain('"gamma-model-10"');
    expect(text).toContain(`(list truncated at ${MAX_LISTED_MODELS_TOTAL} models)`);

    // Every model id carries the `-model-` infix; exactly the capped total is listed.
    const listedCount = (text.match(/-model-/g) ?? []).length;
    expect(listedCount).toBe(MAX_LISTED_MODELS_TOTAL);
  });
});

describe('appendSubAgentModelGuidanceToCallSubAgentTool', () => {
  const makeCallSubAgentTool = (modelDescription?: string) => ({
    function: {
      description: 'Dispatch a single sub-agent.',
      name: 'lobe-agent____callSubAgent',
      parameters: {
        properties: {
          model: {
            description:
              modelDescription ??
              'Optional model ID the sub-agent should run on. Overrides the configured sub-agent model for this call.',
            type: 'string',
          },
          provider: { description: 'Optional provider ID for `model`.', type: 'string' },
        },
        required: ['description', 'instruction'],
        type: 'object',
      },
    },
    type: 'function' as const,
  });

  it('appends guidance to the callSubAgent model parameter description', () => {
    const tool = makeCallSubAgentTool();
    const tools = [tool];
    const ok = appendSubAgentModelGuidanceToCallSubAgentTool(
      tools,
      'callSubAgent valid models:\n"a": {"m1"}',
    );

    expect(ok).toBe(true);
    expect(tool.function.parameters.properties.model.description).toContain(
      'Overrides the configured sub-agent model for this call.\n\ncallSubAgent valid models:\n"a": {"m1"}',
    );
    // Other params untouched.
    expect(tool.function.parameters.properties.provider.description).toBe(
      'Optional provider ID for `model`.',
    );
  });

  it('returns false and mutates nothing when the callSubAgent tool is absent', () => {
    const tools = [
      {
        function: { name: 'lobe-web-browsing____search', parameters: { properties: {} } },
        type: 'function' as const,
      },
    ];
    expect(appendSubAgentModelGuidanceToCallSubAgentTool(tools, 'guidance')).toBe(false);
  });

  it('returns false when the tool has no model parameter (unexpected schema shape)', () => {
    const tool = {
      function: {
        name: 'lobe-agent____callSubAgent',
        parameters: { properties: {} },
      },
      type: 'function' as const,
    };
    const tools = [tool];
    expect(appendSubAgentModelGuidanceToCallSubAgentTool(tools, 'guidance')).toBe(false);
  });

  it('handles undefined tools and sets the description when it was missing', () => {
    expect(appendSubAgentModelGuidanceToCallSubAgentTool(undefined, 'guidance')).toBe(false);

    const tool = {
      function: {
        name: 'lobe-agent____callSubAgent',
        parameters: { properties: { model: { type: 'string' } } },
      },
      type: 'function' as const,
    };
    expect(appendSubAgentModelGuidanceToCallSubAgentTool([tool], 'guidance-text')).toBe(true);
    expect((tool.function.parameters.properties.model as any).description).toBe('guidance-text');
  });
});

describe('resolveSubAgentModelGuidance', () => {
  beforeEach(() => {
    clearSubAgentModelAvailabilityCache();
    mockGetAllModels.mockReset();
    mockGetAiProviderList.mockReset();
  });

  it('resolves guidance from enabled chat models of enabled providers only', async () => {
    mockGetAiProviderList.mockResolvedValue([
      { id: 'openai', enabled: true },
      { id: 'deepseek', enabled: false },
      { id: 'xiaomimimo', enabled: false },
    ]);
    mockGetAllModels.mockResolvedValue([
      { id: 'gpt-5.6-sol', providerId: 'openai', enabled: true, type: 'chat' },
      { id: 'deepseek-v4-pro', providerId: 'deepseek', enabled: true, type: 'chat' },
      { id: 'mimo-v2.5', providerId: 'xiaomimimo', enabled: true, type: 'chat' },
      { id: 'embed', providerId: 'openai', enabled: true, type: 'embedding' },
    ]);

    const { resolveSubAgentModelGuidance } = await import('../subAgentModelGuidance');

    const guidance = await resolveSubAgentModelGuidance({} as any, 'user-1');

    expect(guidance).toBe(
      'callSubAgent valid models (model paired with its exact provider):\n"openai": {"gpt-5.6-sol"}',
    );
  });

  it('returns undefined when no provider is enabled', async () => {
    mockGetAiProviderList.mockResolvedValue([{ id: 'openai', enabled: false }]);
    mockGetAllModels.mockResolvedValue([
      { id: 'gpt-5.6-sol', providerId: 'openai', enabled: true, type: 'chat' },
    ]);

    const { resolveSubAgentModelGuidance } = await import('../subAgentModelGuidance');

    const guidance = await resolveSubAgentModelGuidance({} as any, 'user-none');

    expect(guidance).toBeUndefined();
  });

  it('caches per user and does not re-query within TTL', async () => {
    mockGetAiProviderList.mockResolvedValue([{ id: 'openai', enabled: true }]);
    mockGetAllModels.mockResolvedValue([
      { id: 'gpt-5.6-sol', providerId: 'openai', enabled: true, type: 'chat' },
    ]);

    const { resolveSubAgentModelGuidance } = await import('../subAgentModelGuidance');

    await resolveSubAgentModelGuidance({} as any, 'user-cache');
    await resolveSubAgentModelGuidance({} as any, 'user-cache');

    expect(mockGetAllModels).toHaveBeenCalledTimes(1);
    expect(mockGetAiProviderList).toHaveBeenCalledTimes(1);
  });

  it('separates cache keys by workspace', async () => {
    mockGetAiProviderList.mockResolvedValue([{ id: 'openai', enabled: true }]);
    mockGetAllModels.mockResolvedValue([
      { id: 'gpt-5.6-sol', providerId: 'openai', enabled: true, type: 'chat' },
    ]);

    const { resolveSubAgentModelGuidance } = await import('../subAgentModelGuidance');

    await resolveSubAgentModelGuidance({} as any, 'user-ws', 'ws-1');
    await resolveSubAgentModelGuidance({} as any, 'user-ws', 'ws-2');

    expect(mockGetAllModels).toHaveBeenCalledTimes(2);
  });

  it('fails open and does not cache on error', async () => {
    mockGetAiProviderList.mockResolvedValue([{ id: 'openai', enabled: true }]);
    mockGetAllModels.mockRejectedValueOnce(new Error('db down'));

    const { resolveSubAgentModelGuidance } = await import('../subAgentModelGuidance');

    const guidance = await resolveSubAgentModelGuidance({} as any, 'user-err');

    expect(guidance).toBeUndefined();
  });
});

describe('isSubAgentModelEnabled', () => {
  beforeEach(() => {
    clearSubAgentModelAvailabilityCache();
    mockGetAllModels.mockReset();
    mockGetAiProviderList.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('accepts an enabled chat model of an enabled provider', async () => {
    mockGetAiProviderList.mockResolvedValue([
      { id: 'openai', enabled: true },
      { id: 'deepseek', enabled: false },
    ]);
    mockGetAllModels.mockResolvedValue([
      { id: 'gpt-5.6-sol', providerId: 'openai', enabled: true, type: 'chat' },
      { id: 'deepseek-v4-pro', providerId: 'deepseek', enabled: true, type: 'chat' },
    ]);

    const { isSubAgentModelEnabled } = await import('../subAgentModelGuidance');

    await expect(
      isSubAgentModelEnabled({} as any, 'user-1', undefined, 'openai', 'gpt-5.6-sol'),
    ).resolves.toBe(true);
  });

  it('rejects models of a disabled provider even when the model row is enabled', async () => {
    mockGetAiProviderList.mockResolvedValue([
      { id: 'openai', enabled: true },
      { id: 'deepseek', enabled: false },
    ]);
    mockGetAllModels.mockResolvedValue([
      { id: 'deepseek-v4-pro', providerId: 'deepseek', enabled: true, type: 'chat' },
    ]);

    const { isSubAgentModelEnabled } = await import('../subAgentModelGuidance');

    await expect(
      isSubAgentModelEnabled({} as any, 'user-1', undefined, 'deepseek', 'deepseek-v4-pro'),
    ).resolves.toBe(false);
  });

  it('allows model ids without a row and rejects disabled / non-chat rows', async () => {
    mockGetAiProviderList.mockResolvedValue([{ id: 'openai', enabled: true }]);
    mockGetAllModels.mockResolvedValue([
      { id: 'gpt-5.6-sol', providerId: 'openai', enabled: true, type: 'chat' },
      { id: 'disabled-model', providerId: 'openai', enabled: false, type: 'chat' },
      { id: 'embed', providerId: 'openai', enabled: true, type: 'embedding' },
    ]);

    const { isSubAgentModelEnabled } = await import('../subAgentModelGuidance');

    // No ai_models row → user-typed model id → allowed.
    await expect(
      isSubAgentModelEnabled({} as any, 'user-1', undefined, 'openai', 'unknown-model'),
    ).resolves.toBe(true);
    // Row exists but disabled.
    await expect(
      isSubAgentModelEnabled({} as any, 'user-1', undefined, 'openai', 'disabled-model'),
    ).resolves.toBe(false);
    // Row exists but non-chat.
    await expect(
      isSubAgentModelEnabled({} as any, 'user-1', undefined, 'openai', 'embed'),
    ).resolves.toBe(false);
  });

  it('allows a provider with no ai_providers row (custom provider)', async () => {
    mockGetAiProviderList.mockResolvedValue([{ id: 'openai', enabled: true }]);
    mockGetAllModels.mockResolvedValue([
      { id: 'gpt-5.6-sol', providerId: 'openai', enabled: true, type: 'chat' },
    ]);

    const { isSubAgentModelEnabled } = await import('../subAgentModelGuidance');

    await expect(
      isSubAgentModelEnabled(
        {} as any,
        'user-custom-provider',
        undefined,
        'custom-provider',
        'custom-model',
      ),
    ).resolves.toBe(true);
  });

  it('allows a user-typed model with no ai_models row under an enabled provider', async () => {
    mockGetAiProviderList.mockResolvedValue([{ id: 'openai', enabled: true }]);
    mockGetAllModels.mockResolvedValue([
      { id: 'gpt-5.6-sol', providerId: 'openai', enabled: true, type: 'chat' },
    ]);

    const { isSubAgentModelEnabled } = await import('../subAgentModelGuidance');

    await expect(
      isSubAgentModelEnabled(
        {} as any,
        'user-typed-model',
        undefined,
        'openai',
        'hand-typed-model',
      ),
    ).resolves.toBe(true);
  });

  it('re-queries after the availability cache TTL expires', async () => {
    vi.useFakeTimers();
    mockGetAiProviderList.mockResolvedValue([{ id: 'openai', enabled: true }]);
    mockGetAllModels.mockResolvedValue([
      { id: 'gpt-5.6-sol', providerId: 'openai', enabled: true, type: 'chat' },
    ]);

    const { isSubAgentModelEnabled } = await import('../subAgentModelGuidance');

    await isSubAgentModelEnabled({} as any, 'user-ttl', undefined, 'openai', 'gpt-5.6-sol');
    expect(mockGetAllModels).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(SUB_AGENT_MODEL_GUIDANCE_TTL_MS + 1);

    await isSubAgentModelEnabled({} as any, 'user-ttl', undefined, 'openai', 'gpt-5.6-sol');
    expect(mockGetAllModels).toHaveBeenCalledTimes(2);
  });

  it('shares the availability cache with the guidance resolver', async () => {
    mockGetAiProviderList.mockResolvedValue([{ id: 'openai', enabled: true }]);
    mockGetAllModels.mockResolvedValue([
      { id: 'gpt-5.6-sol', providerId: 'openai', enabled: true, type: 'chat' },
    ]);

    const { isSubAgentModelEnabled, resolveSubAgentModelGuidance } =
      await import('../subAgentModelGuidance');

    await isSubAgentModelEnabled({} as any, 'user-cache2', undefined, 'openai', 'gpt-5.6-sol');
    await resolveSubAgentModelGuidance({} as any, 'user-cache2');

    expect(mockGetAllModels).toHaveBeenCalledTimes(1);
    expect(mockGetAiProviderList).toHaveBeenCalledTimes(1);
  });
});
