// @vitest-environment node
import { ModelRuntime } from '@lobechat/model-runtime';
import { describe, expect, it, vi } from 'vitest';

import { initModelRuntimeFromDB, resolveProviderResponseApiMode } from './index';

const providerRows = vi.hoisted(() => new Map<string, any>());

vi.mock('@/database/models/aiProvider', () => ({
  AiProviderModel: class {
    async getAiProviderById(id: string) {
      return providerRows.get(id);
    }
  },
}));

vi.mock('@/server/globalConfig', () => ({
  getServerAiProviderConfig: async () => undefined,
}));

vi.mock('@/envs/llm', () => ({ getLLMConfig: () => ({}) }));

vi.mock('@/business/server/model-runtime', () => ({
  getBusinessModelRuntimeHooks: () => undefined,
}));

vi.mock('@/server/services/llmGenerationTracing/hook', () => ({
  createLLMGenerationTracingHook: () => undefined,
}));

const db = {} as any;

const initSpy = () => vi.spyOn(ModelRuntime, 'initializeWithProvider');

describe('initModelRuntimeFromDB and the provider Responses switch', () => {
  it('should hand the switch to the runtime so structured output follows it', async () => {
    providerRows.set('magpie', {
      config: { enableResponseApi: true },
      keyVaults: { apiKey: 'k' },
    });
    const spy = initSpy();

    await initModelRuntimeFromDB(db, 'user-1', 'magpie');

    expect(spy).toHaveBeenCalledWith(
      'magpie',
      expect.objectContaining({ responseApiMode: 'responses' }),
      undefined,
    );
  });

  it('should hand an explicit off switch through as well', async () => {
    providerRows.set('magpie', {
      config: { enableResponseApi: false },
      keyVaults: { apiKey: 'k' },
    });
    const spy = initSpy();

    await initModelRuntimeFromDB(db, 'user-1', 'magpie');

    expect(spy).toHaveBeenCalledWith(
      'magpie',
      expect.objectContaining({ responseApiMode: 'chatCompletion' }),
      undefined,
    );
  });

  it('should leave the mode unset when the row never expressed a preference', async () => {
    providerRows.set('magpie', { keyVaults: { apiKey: 'k' } });
    const spy = initSpy();

    await initModelRuntimeFromDB(db, 'user-1', 'magpie');

    const options = spy.mock.calls[0][1] as Record<string, unknown>;
    expect(options.responseApiMode).toBeUndefined();
  });
});

describe('resolveProviderResponseApiMode', () => {
  it('should read the provider row', async () => {
    providerRows.set('magpie', { config: { enableResponseApi: true } });
    providerRows.set('openai', { config: { enableResponseApi: false } });

    await expect(resolveProviderResponseApiMode(db, 'user-1', 'magpie')).resolves.toBe('responses');
    await expect(resolveProviderResponseApiMode(db, 'user-1', 'openai')).resolves.toBe(
      'chatCompletion',
    );
  });

  it('should answer undefined when the row has no switch', async () => {
    providerRows.set('magpie', { config: {} });

    await expect(resolveProviderResponseApiMode(db, 'user-1', 'magpie')).resolves.toBeUndefined();
  });
});
