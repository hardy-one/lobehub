import { pickTrimmedString, toRecord } from '@lobechat/utils/object';
import debug from 'debug';

import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';

const log = debug('lobe-server:market');

/**
 * Read the persisted Market access token for a user.
 *
 * User settings are JSONB and may contain legacy or malformed values, so the
 * value is narrowed at the boundary rather than trusting a cast at every
 * MarketService call site. Failure is intentionally non-fatal: callers retain
 * MarketService's trusted-client-token fallback.
 */
export const getMarketAccessToken = async (
  db: LobeChatDatabase,
  userId: string,
): Promise<string | undefined> => {
  try {
    const settings = await new UserModel(db, userId).getUserSettings();
    return pickTrimmedString(toRecord(settings?.market)?.accessToken);
  } catch (error) {
    log('getMarketAccessToken: failed to read token for user %s: %O', userId, error);
    return undefined;
  }
};
