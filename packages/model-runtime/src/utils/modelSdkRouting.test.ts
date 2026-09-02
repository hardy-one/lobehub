import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveModelSdkType } from './modelSdkRouting';

const metadata = vi.hoisted(() => ({ modelIdsBySdk: {} as Record<string, string[]> }));
vi.mock('../providers/utils/modelsDev', () => ({
  getCachedModelsDevRoutingMetadata: () => metadata,
}));

describe('provider-scoped SDK routing', () => {
  beforeEach(() => {
    metadata.modelIdsBySdk = {};
  });
  const resolve = (options = {}) =>
    resolveModelSdkType({
      bankModels: [{ id: 'same-model', sdkType: 'google' }],
      model: 'same-model',
      modelsDevProvider: 'test-provider',
      options,
    });

  it('prefers a user model override over a provider protocol and fetched metadata', () => {
    expect(
      resolve({
        modelSdkOverrides: { 'same-model': 'anthropic' },
        providerSdkType: 'openai',
        modelSdkTypes: { 'same-model': 'google' },
      }),
    ).toBe('anthropic');
  });
  it('uses an explicit provider protocol before fetched model metadata', () => {
    expect(
      resolve({ providerSdkType: 'openai', modelSdkTypes: { 'same-model': 'anthropic' } }),
    ).toBe('openai');
  });
  it('uses persisted metadata after a cold start', () => {
    expect(resolve({ modelSdkTypes: { 'same-model': 'anthropic' } })).toBe('anthropic');
  });
  it('distinguishes Responses from Chat Completions', () => {
    metadata.modelIdsBySdk = { '@ai-sdk/openai': ['same-model'] };
    expect(resolve()).toBe('openai-responses');
    metadata.modelIdsBySdk = { '@ai-sdk/openai-compatible': ['same-model'] };
    expect(resolve()).toBe('openai');
  });
  it('does not promote a model family into a global SDK declaration', () => {
    expect(
      resolveModelSdkType({
        bankModels: [],
        model: 'qwen-new',
        modelsDevProvider: 'another-provider',
        options: {},
      }),
    ).toBeUndefined();
    expect(resolve()).toBe('google');
  });
});
