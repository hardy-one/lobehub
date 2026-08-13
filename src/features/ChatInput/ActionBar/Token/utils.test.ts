import { describe, expect, it } from 'vitest';

import {
  getToolContextRefreshKey,
  getToolExcludeDefaultToolIds,
  isContextTokensCurrent,
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

  describe('isContextTokensCurrent', () => {
    const entry = {
      chats: 1,
      historySummary: 0,
      mode: 'agent:full',
      systemRole: 100,
      tools: 200,
      topicId: 'topic-1',
    };

    it('accepts matching topic and mode', () => {
      expect(isContextTokensCurrent(entry, 'topic-1', 'agent:full')).toBe(true);
    });

    it('rejects a different topic', () => {
      expect(isContextTokensCurrent(entry, 'topic-2', 'agent:full')).toBe(false);
    });

    it('rejects when the mode switched since the measurement', () => {
      expect(isContextTokensCurrent(entry, 'topic-1', 'agent:lean')).toBe(false);
      expect(isContextTokensCurrent(entry, 'topic-1', 'chat:full')).toBe(false);
    });

    it('keeps legacy entries without a mode stamp valid', () => {
      const { mode: _mode, ...legacy } = entry;
      expect(isContextTokensCurrent(legacy, 'topic-1', 'chat:full')).toBe(true);
    });

    it('rejects undefined entries', () => {
      expect(isContextTokensCurrent(undefined, 'topic-1', 'agent:full')).toBe(false);
    });
  });
});
