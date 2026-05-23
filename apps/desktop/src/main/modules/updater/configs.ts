import type { UpdateChannel } from '@lobechat/electron-client-ipc';

import { isDev } from '@/const/env';
import { getDesktopEnv } from '@/env';

// Build-time default channel, can be overridden at runtime via store
const rawChannel = getDesktopEnv().UPDATE_CHANNEL || 'stable';

export const coerceStoredUpdateChannel = (channel?: string | null): UpdateChannel => {
  if (channel === 'Hardy' || channel === 'hardy' || channel === 'HARDY') return 'HARDY';
  if (channel === 'canary') return 'canary';
  return 'stable';
};

/** Raw build channel for display (stable, canary, beta, or Hardy). */
export const BUILD_CHANNEL: string =
  rawChannel === 'Hardy' || rawChannel === 'hardy' || rawChannel === 'HARDY' ? 'HARDY' : rawChannel;
export const UPDATE_CHANNEL: UpdateChannel =
  rawChannel === 'canary'
    ? 'canary'
    : rawChannel === 'Hardy' || rawChannel === 'hardy' || rawChannel === 'HARDY'
      ? 'HARDY'
      : 'stable';

// S3 base URL for all channels
// e.g., https://releases.lobehub.com
// Each channel resolves to {base}/{channel}/
export const UPDATE_SERVER_URL = getDesktopEnv().UPDATE_SERVER_URL;

export const updaterConfig = {
  app: {
    autoCheckUpdate: true,
    autoDownloadUpdate: true,
    checkUpdateInterval: 60 * 60 * 1000, // 1 hour
  },
  enableAppUpdate: !isDev,
};
