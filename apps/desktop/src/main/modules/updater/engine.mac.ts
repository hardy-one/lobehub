import type { UpdateChannel } from '@lobechat/electron-client-ipc';
import { app } from 'electron';

import { getSparkleFeedUrl, UPDATE_SERVER_URL } from './configs';
import { electronUpdaterEngine } from './electronUpdaterEngine';
import type { UpdateEngine, UpdateEngineKind } from './engine';
import { SparkleEngine } from './sparkleEngine';

/**
 * macOS serves stable/canary from Sparkle appcasts while HARDY is published as
 * GitHub releases, so the engine has to follow the channel rather than the
 * channel the app happened to launch with.
 */
export const resolveUpdateEngineKind = (channel: UpdateChannel): UpdateEngineKind =>
  channel === 'HARDY' ? 'electron-updater' : 'sparkle';

export const createUpdateEngine = async (channel: UpdateChannel): Promise<UpdateEngine> => {
  if (resolveUpdateEngineKind(channel) === 'electron-updater') return electronUpdaterEngine;
  if (!UPDATE_SERVER_URL) throw new Error('Sparkle requires UPDATE_SERVER_URL');
  return SparkleEngine.create({
    appcastUrl: getSparkleFeedUrl(UPDATE_SERVER_URL, channel),
    currentVersion: app.getVersion(),
  });
};
