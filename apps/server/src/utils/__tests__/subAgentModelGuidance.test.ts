import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearSubAgentModelAvailabilityCache,
  formatSubAgentModelGuidance,
  MAX_LISTED_MODELS_PER_PROVIDER,
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
