import { describe, expect, it } from 'vitest';

import {
  getLatestProviderUsage,
  getProviderInputTokens,
  getToolContextRefreshKey,
  getToolExcludeDefaultToolIds,
} from './utils';

describe('Token tool utils', () => {
  describe('getToolContextRefreshKey', () => {
    it('changes when web search switches between off and application search', () => {
      const baseKey = getToolContextRefreshKey({
        agentId: 'agent-1',
        searchMode: 'off',
        useModelBuiltinSearch: false,
      });

      expect(
        getToolContextRefreshKey({
          agentId: 'agent-1',
          searchMode: 'auto',
          useModelBuiltinSearch: false,
        }),
      ).not.toBe(baseKey);
    });

    it('changes when web search switches between application and model builtin search', () => {
      const appSearchKey = getToolContextRefreshKey({
        agentId: 'agent-1',
        searchMode: 'auto',
        useModelBuiltinSearch: false,
      });

      expect(
        getToolContextRefreshKey({
          agentId: 'agent-1',
          searchMode: 'auto',
          useModelBuiltinSearch: true,
        }),
      ).not.toBe(appSearchKey);
    });

    it('changes when switching between chat and agent modes', () => {
      const chatModeKey = getToolContextRefreshKey({
        agentId: 'agent-1',
        enableAgentMode: false,
      });

      expect(
        getToolContextRefreshKey({
          agentId: 'agent-1',
          enableAgentMode: true,
        }),
      ).not.toBe(chatModeKey);
    });
  });

  describe('getToolExcludeDefaultToolIds', () => {
    it('excludes discovery tools in manual skill mode', () => {
      expect(getToolExcludeDefaultToolIds('manual')).toEqual(
        expect.arrayContaining(['lobe-activator', 'lobe-skill-store']),
      );
    });

    it('keeps default tools in auto skill mode', () => {
      expect(getToolExcludeDefaultToolIds('auto')).toBeUndefined();
    });
  });
  describe('provider usage', () => {
    it('sums uncached input, cache read, and cache write without totalInputTokens', () => {
      expect(
        getProviderInputTokens({
          inputCacheMissTokens: 1_900,
          inputCachedTokens: 25_200,
          inputWriteCacheTokens: 0,
        }),
      ).toBe(27_100);
    });

    it('uses the latest successful assistant usage', () => {
      expect(
        getLatestProviderUsage([
          {
            id: 'failed',
            role: 'assistant',
            error: { type: 'provider' },
            usage: { totalInputTokens: 10 },
          },
          { id: 'success', role: 'assistant', usage: { totalInputTokens: 20 } },
        ]),
      ).toEqual({ id: 'success', index: 1, inputTokens: 20 });
    });

    it('returns no baseline when a message only reports output usage', () => {
      expect(getProviderInputTokens({ totalOutputTokens: 20 })).toBeUndefined();
    });
  });
});
