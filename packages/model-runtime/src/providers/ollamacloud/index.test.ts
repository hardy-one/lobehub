// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LobeOllamaCloudAI } from './index';

const mocks = vi.hoisted(() => ({ constructor: vi.fn(), list: vi.fn() }));
vi.mock('ollama/browser', () => ({
  Ollama: class {
    list = mocks.list;
    constructor(options: unknown) {
      mocks.constructor(options);
    }
  },
}));

describe('LobeOllamaCloudAI native SDK', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockResolvedValue({ models: [] });
  });

  it('uses the native Ollama host and Bearer authentication', () => {
    const instance = new LobeOllamaCloudAI({ apiKey: 'test_api_key' });
    expect(instance.baseURL).toBe('https://ollama.com');
    expect(mocks.constructor).toHaveBeenCalledWith({
      host: 'https://ollama.com',
      headers: { Authorization: 'Bearer test_api_key' },
    });
  });
  it('supports optional authentication', () => {
    new LobeOllamaCloudAI();
    expect(mocks.constructor).toHaveBeenCalledWith({ host: 'https://ollama.com' });
  });
  it('preserves a custom host', () => {
    const instance = new LobeOllamaCloudAI({ baseURL: 'https://custom.ollama.example' });
    expect(instance.baseURL).toBe('https://custom.ollama.example');
    expect(mocks.constructor).toHaveBeenCalledWith({ host: 'https://custom.ollama.example' });
  });
  it('reads models from the native list endpoint', async () => {
    mocks.list.mockResolvedValue({ models: [{ name: 'custom-model' }] });
    const instance = new LobeOllamaCloudAI();
    expect(await instance.models()).toEqual([expect.objectContaining({ id: 'custom-model' })]);
    expect(mocks.list).toHaveBeenCalledOnce();
  });
  it('returns an empty catalog and propagates list failures', async () => {
    const instance = new LobeOllamaCloudAI();
    expect(await instance.models()).toEqual([]);
    mocks.list.mockRejectedValue(new Error('API Error'));
    await expect(instance.models()).rejects.toThrow('API Error');
  });
});
