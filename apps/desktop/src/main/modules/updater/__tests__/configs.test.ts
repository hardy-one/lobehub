import { afterEach, describe, expect, it, vi } from 'vitest';

const loadConfigs = async (channel?: string) => {
  vi.resetModules();
  vi.doMock('@/const/env', () => ({ isDev: false }));
  vi.doMock('@/env', () => ({
    getDesktopEnv: () => ({ UPDATE_CHANNEL: channel, UPDATE_SERVER_URL: undefined }),
  }));

  return import('../configs');
};

afterEach(() => {
  vi.doUnmock('@/const/env');
  vi.doUnmock('@/env');
  vi.resetModules();
});

describe('updater configs', () => {
  it.each([
    ['canary', 'canary', 'canary'],
    ['Hardy', 'HARDY', 'HARDY'],
    ['hardy', 'HARDY', 'HARDY'],
    ['HARDY', 'HARDY', 'HARDY'],
    ['beta', 'beta', 'stable'],
    [undefined, 'stable', 'stable'],
  ])(
    'maps build channel %s to display %s and update channel %s',
    async (rawChannel, buildChannel, updateChannel) => {
      const configs = await loadConfigs(rawChannel);

      expect(configs.BUILD_CHANNEL).toBe(buildChannel);
      expect(configs.UPDATE_CHANNEL).toBe(updateChannel);
    },
  );

  it.each([
    ['canary', 'canary'],
    ['Hardy', 'HARDY'],
    ['hardy', 'HARDY'],
    ['HARDY', 'HARDY'],
    ['beta', 'stable'],
    ['unknown', 'stable'],
    [null, 'stable'],
    [undefined, 'stable'],
  ])('normalizes stored channel %s to %s', async (storedChannel, expectedChannel) => {
    const { coerceStoredUpdateChannel } = await loadConfigs();

    expect(coerceStoredUpdateChannel(storedChannel)).toBe(expectedChannel);
  });
});
