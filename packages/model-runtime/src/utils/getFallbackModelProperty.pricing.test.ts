import { describe, expect, it, vi } from 'vitest';

import { getModelPropertyWithFallback } from './getFallbackModelProperty';

vi.mock('model-bank', () => ({
  LOBE_DEFAULT_MODEL_LIST: [
    // Regular provider with pricing
    {
      id: 'MiniMax-M2.5',
      providerId: 'minimax',
      type: 'chat',
      displayName: 'MiniMax M2.5',
      contextWindowTokens: 204_800,
      enabled: true,
      pricing: {
        currency: 'CNY',
        units: [
          { name: 'textInput', rate: 2.1, strategy: 'fixed', unit: 'millionTokens' },
          { name: 'textOutput', rate: 8.4, strategy: 'fixed', unit: 'millionTokens' },
        ],
      },
    },
    // Coding plan provider — same model ID, no pricing
    {
      id: 'MiniMax-M2.5',
      providerId: 'minimaxcodingplan',
      type: 'chat',
      displayName: 'MiniMax M2.5',
      contextWindowTokens: 204_800,
      enabled: true,
    },
    // Qwen regular provider with pricing
    {
      id: 'qwen3.5-plus',
      providerId: 'qwen',
      type: 'chat',
      displayName: 'Qwen3.5 Plus',
      contextWindowTokens: 1_000_000,
      enabled: true,
      pricing: {
        currency: 'CNY',
        units: [{ name: 'textInput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' }],
      },
    },
    // Bailian coding plan — same model ID, no pricing
    {
      id: 'qwen3.5-plus',
      providerId: 'bailiancodingplan',
      type: 'chat',
      displayName: 'Qwen3.5 Plus',
      contextWindowTokens: 1_000_000,
      enabled: true,
    },
    // Unique model — only in one provider
    {
      id: 'unique-model',
      providerId: 'someprovider',
      type: 'chat',
      displayName: 'Unique Model',
      pricing: {
        currency: 'USD',
        units: [{ name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' }],
      },
    },
  ],
}));

describe('getModelPropertyWithFallback - pricing isolation', () => {
  describe('should NOT fallback pricing across providers', () => {
    it('returns undefined for pricing when coding plan model has no pricing (minimaxcodingplan)', async () => {
      const result = await getModelPropertyWithFallback(
        'MiniMax-M2.5',
        'pricing',
        'minimaxcodingplan',
      );
      expect(result).toBeUndefined();
    });

    it('returns undefined for pricing when coding plan model has no pricing (bailiancodingplan)', async () => {
      const result = await getModelPropertyWithFallback(
        'qwen3.5-plus',
        'pricing',
        'bailiancodingplan',
      );
      expect(result).toBeUndefined();
    });

    it('returns pricing from exact match when regular provider has pricing', async () => {
      const result = await getModelPropertyWithFallback('MiniMax-M2.5', 'pricing', 'minimax');
      expect(result).toEqual({
        currency: 'CNY',
        units: [
          { name: 'textInput', rate: 2.1, strategy: 'fixed', unit: 'millionTokens' },
          { name: 'textOutput', rate: 8.4, strategy: 'fixed', unit: 'millionTokens' },
        ],
      });
    });
  });

  describe('should still fallback pricing WITHOUT providerId', () => {
    it('finds pricing when no providerId is specified', async () => {
      const result = await getModelPropertyWithFallback('MiniMax-M2.5', 'pricing');
      expect(result).toEqual({
        currency: 'CNY',
        units: [
          { name: 'textInput', rate: 2.1, strategy: 'fixed', unit: 'millionTokens' },
          { name: 'textOutput', rate: 8.4, strategy: 'fixed', unit: 'millionTokens' },
        ],
      });
    });
  });

  describe('other properties should still fallback with providerId', () => {
    it('falls back displayName across providers when exact match lacks it', async () => {
      // 'fake-provider' doesn't exist, should fallback to first match
      const result = await getModelPropertyWithFallback(
        'MiniMax-M2.5',
        'displayName',
        'fake-provider',
      );
      expect(result).toBe('MiniMax M2.5');
    });

    it('falls back contextWindowTokens across providers when exact match lacks it', async () => {
      const result = await getModelPropertyWithFallback(
        'MiniMax-M2.5',
        'contextWindowTokens',
        'fake-provider',
      );
      expect(result).toBe(204_800);
    });

    it('returns type from exact match when available', async () => {
      const result = await getModelPropertyWithFallback(
        'MiniMax-M2.5',
        'type',
        'minimaxcodingplan',
      );
      expect(result).toBe('chat');
    });
  });

  describe('unique model with no ID collision', () => {
    it('returns pricing from the only provider', async () => {
      const result = await getModelPropertyWithFallback('unique-model', 'pricing', 'someprovider');
      expect(result).toEqual({
        currency: 'USD',
        units: [{ name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' }],
      });
    });
  });
});
