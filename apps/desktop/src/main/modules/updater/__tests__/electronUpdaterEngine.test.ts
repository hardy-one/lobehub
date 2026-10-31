import { beforeEach, describe, expect, it, vi } from 'vitest';

import { electronUpdaterEngine, toUpdaterChannel } from '../electronUpdaterEngine';

const { mockAutoUpdater } = vi.hoisted(() => ({
  mockAutoUpdater: {
    allowDowngrade: false,
    allowPrerelease: false,
    autoDownload: true,
    autoInstallOnAppQuit: true,
    channel: undefined as string | undefined,
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    forceDevUpdateConfig: false,
    isUpdaterActive: vi.fn(() => true),
    logger: undefined as unknown,
    on: vi.fn(),
    quitAndInstall: vi.fn(),
    setFeedURL: vi.fn(),
  },
}));

vi.mock('electron-updater', () => ({ autoUpdater: mockAutoUpdater }));

vi.mock('electron-log', () => ({
  default: { transports: { file: { level: 'info' } } },
}));

vi.mock('@/const/env', () => ({ isDev: false }));

vi.mock('@/env', () => ({
  getDesktopEnv: () => ({ FORCE_DEV_UPDATE_CONFIG: false, UPDATE_SERVER_URL: undefined }),
}));

beforeEach(() => {
  mockAutoUpdater.allowDowngrade = false;
  mockAutoUpdater.allowPrerelease = false;
  mockAutoUpdater.channel = undefined;
  mockAutoUpdater.forceDevUpdateConfig = false;
  mockAutoUpdater.setFeedURL.mockClear();
});

describe('updater channel handed to electron-updater', () => {
  it('keeps stable and canary unchanged', () => {
    expect(toUpdaterChannel('stable')).toBe('stable');
    expect(toUpdaterChannel('canary')).toBe('canary');
  });

  // Regression: GitHubProvider compares `autoUpdater.channel` with the first
  // prerelease identifier of the release tag, so the display value `HARDY`
  // never matched a published tag and the check failed with
  // ERR_UPDATER_NO_PUBLISHED_VERSIONS. Published tags look like
  // `v2.2.22-hardy.12`, whose prerelease identifier is lowercase `hardy`.
  it('maps HARDY to the release identifier of published hardy tags', () => {
    const publishedTag = 'v2.2.22-hardy.12';
    const releaseChannel = publishedTag.split('-')[1].split('.')[0];

    expect(releaseChannel).toBe('hardy');
    expect(toUpdaterChannel('HARDY')).toBe(releaseChannel);
  });

  it('configures HARDY with the hardy channel against the hardy-one releases', () => {
    electronUpdaterEngine.configure('HARDY');

    expect(mockAutoUpdater.channel).toBe('hardy');
    expect(mockAutoUpdater.allowPrerelease).toBe(true);
    expect(mockAutoUpdater.setFeedURL).toHaveBeenCalledWith({
      owner: 'hardy-one',
      provider: 'github',
      repo: 'lobe-release',
    });
  });

  it('keeps stable on its own channel and the default GitHub releases', () => {
    electronUpdaterEngine.configure('stable');

    expect(mockAutoUpdater.channel).toBe('stable');
    expect(mockAutoUpdater.allowPrerelease).toBe(false);
    expect(mockAutoUpdater.setFeedURL).toHaveBeenCalledWith({
      owner: 'lobehub',
      provider: 'github',
      repo: 'lobehub',
    });
  });
});
