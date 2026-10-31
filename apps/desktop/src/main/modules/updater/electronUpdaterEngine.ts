import type { UpdateChannel } from '@lobechat/electron-client-ipc';
import log from 'electron-log';
import { autoUpdater } from 'electron-updater';

import { isDev } from '@/const/env';
import { getDesktopEnv } from '@/env';

import { UPDATE_SERVER_URL } from './configs';
import type { UpdateEngine } from './engine';

autoUpdater.autoInstallOnAppQuit = false;

/**
 * The app-level channel keeps the display value `HARDY`, but electron-updater
 * resolves GitHub releases by the first prerelease identifier of the tag
 * (`v2.2.22-hardy.12` -> `hardy`). Hand the updater the release identifier so
 * HARDY matches a published release instead of failing with
 * `ERR_UPDATER_NO_PUBLISHED_VERSIONS`.
 */
export const toUpdaterChannel = (channel: UpdateChannel): string =>
  channel === 'HARDY' ? 'hardy' : channel;

export const electronUpdaterEngine: UpdateEngine = {
  checkForUpdates: () => autoUpdater.checkForUpdates(),
  configure: (channel) => {
    log.transports.file.level = 'info';
    autoUpdater.logger = log;
    autoUpdater.autoDownload = false;
    autoUpdater.forceDevUpdateConfig = isDev || getDesktopEnv().FORCE_DEV_UPDATE_CONFIG;
    autoUpdater.allowPrerelease = channel !== 'stable';
    if (!autoUpdater.forceDevUpdateConfig) {
      const baseUrl = UPDATE_SERVER_URL?.replace(/\/(stable|nightly|canary|beta)\/?$/, '').replace(
        /\/$/,
        '',
      );
      autoUpdater.channel = toUpdaterChannel(channel);
      autoUpdater.setFeedURL(
        channel === 'HARDY'
          ? { owner: 'hardy-one', provider: 'github', repo: 'lobe-release' }
          : baseUrl
            ? { provider: 'generic', url: `${baseUrl}/${channel}` }
            : { owner: 'lobehub', provider: 'github', repo: 'lobehub' },
      );
    }
    // The channel setter mutates this flag. Windows/Linux retain rollback support.
    autoUpdater.allowDowngrade = true;
  },
  downloadUpdate: () => autoUpdater.downloadUpdate(),
  installOnQuit: () => {
    autoUpdater.autoInstallOnAppQuit = true;
  },
  isActive: () => autoUpdater.isUpdaterActive(),
  kind: 'electron-updater',
  on: (event, listener) => {
    autoUpdater.on(event, listener as (...args: any[]) => void);
  },
  quitAndInstall: () => autoUpdater.quitAndInstall(true, true),
};
