import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockIsProviderEnabled = vi.fn();
const mockGetAiProviderModelList = vi.fn();
const mockGetAiInfraStoreState = vi.fn();

vi.mock('@/store/aiInfra', () => ({
  aiProviderSelectors: {
    isProviderEnabled: (id: string) => () => mockIsProviderEnabled(id),
  },
  getAiInfraStoreState: () => mockGetAiInfraStoreState(),
}));

vi.mock('@/services/aiModel', () => ({
  aiModelService: {
    getAiProviderModelList: (...args: any[]) => mockGetAiProviderModelList(...args),
  },
}));

const { isClientSubAgentModelEnabled } = await import('./subAgentModelGuard');

describe('isClientSubAgentModelEnabled', () => {
  beforeEach(() => {
    mockIsProviderEnabled.mockReset();
    mockGetAiProviderModelList.mockReset();
    mockGetAiInfraStoreState.mockReset();
    mockGetAiInfraStoreState.mockReturnValue({
      aiProviderList: [
        { id: 'openai', enabled: true },
        { id: 'deepseek', enabled: false },
        { id: 'siliconcloud', enabled: true },
      ],
    });
  });

  it('accepts an enabled chat model of an enabled provider', async () => {
    mockIsProviderEnabled.mockReturnValue(true);
    mockGetAiProviderModelList.mockResolvedValue([
      { id: 'gpt-5.6-sol', enabled: true, type: 'chat' },
      { id: 'embed', enabled: true, type: 'embedding' },
    ]);

    await expect(isClientSubAgentModelEnabled('openai', 'gpt-5.6-sol')).resolves.toBe(true);
  });

  it('rejects immediately when the provider is not enabled', async () => {
    mockIsProviderEnabled.mockReturnValue(false);

    await expect(isClientSubAgentModelEnabled('deepseek', 'deepseek-v4-pro')).resolves.toBe(false);
    expect(mockGetAiProviderModelList).not.toHaveBeenCalled();
  });

  it('rejects disabled or non-chat models of an enabled provider', async () => {
    mockIsProviderEnabled.mockReturnValue(true);
    mockGetAiProviderModelList.mockResolvedValue([
      { id: 'deepseek-v4-flash', enabled: false, type: 'chat' },
      { id: 'embed', enabled: true, type: 'embedding' },
    ]);

    await expect(isClientSubAgentModelEnabled('siliconcloud', 'deepseek-v4-flash')).resolves.toBe(
      false,
    );
    await expect(isClientSubAgentModelEnabled('siliconcloud', 'embed')).resolves.toBe(false);
  });

  it('fails closed when the model list cannot be fetched', async () => {
    mockIsProviderEnabled.mockReturnValue(true);
    mockGetAiProviderModelList.mockRejectedValue(new Error('network'));

    await expect(isClientSubAgentModelEnabled('openai', 'gpt-5.6-sol')).resolves.toBe(false);
  });

  it('allows a provider unknown to the store (user-typed custom provider)', async () => {
    await expect(isClientSubAgentModelEnabled('custom-provider', 'custom-model')).resolves.toBe(
      true,
    );
    expect(mockIsProviderEnabled).not.toHaveBeenCalled();
    expect(mockGetAiProviderModelList).not.toHaveBeenCalled();
  });

  it('allows a model with no row under a known enabled provider (user-typed model)', async () => {
    mockIsProviderEnabled.mockReturnValue(true);
    mockGetAiProviderModelList.mockResolvedValue([
      { id: 'gpt-5.6-sol', enabled: true, type: 'chat' },
    ]);

    await expect(isClientSubAgentModelEnabled('openai', 'hand-typed-model')).resolves.toBe(true);
  });
});
