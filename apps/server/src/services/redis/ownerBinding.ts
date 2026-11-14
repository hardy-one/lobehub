import { RedisKeys } from '@/server/modules/Redis';

import { getRedisServiceClient } from './client';

export const OWNER_BINDING_TTL_SECONDS = 15 * 60;

const CLAIM_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local state = cjson.decode(raw)
if state.code ~= ARGV[1] then return 0 end
if state.claimed then return -1 end
local ttl = redis.call('PTTL', KEYS[1])
if ttl <= 0 then return 0 end
state.claimed = true
redis.call('SET', KEYS[1], cjson.encode(state), 'PX', ttl)
return 1
`;

const COMPLETE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local state = cjson.decode(raw)
if state.code ~= ARGV[1] or not state.claimed then return 0 end
return redis.call('DEL', KEYS[1])
`;

const RELEASE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local state = cjson.decode(raw)
if state.code ~= ARGV[1] or not state.claimed then return 0 end
local ttl = redis.call('PTTL', KEYS[1])
if ttl <= 0 then return 0 end
state.claimed = false
redis.call('SET', KEYS[1], cjson.encode(state), 'PX', ttl)
return 1
`;

type OwnerBindingClaimResult = 'claimed' | 'invalid' | 'unavailable';
type OwnerBindingCompleteResult = 'consumed' | 'invalid' | 'unavailable';

export const ownerBinding = {
  /** Store the bot's only current owner code, replacing any prior code. */
  async issue(platform: string, applicationId: string, code: string): Promise<number | null> {
    try {
      const redis = await getRedisServiceClient('ownerBinding');
      if (!redis) return null;

      const expiresAt = Date.now() + OWNER_BINDING_TTL_SECONDS * 1000;
      const result = await redis.set(
        RedisKeys.ownerBinding.code(platform, applicationId),
        JSON.stringify({ claimed: false, code }),
        { ex: OWNER_BINDING_TTL_SECONDS },
      );
      return result === 'OK' ? expiresAt : null;
    } catch (error) {
      console.error('[redis:owner-binding] Failed to issue code:', error);
      return null;
    }
  },

  /** Claim the current code while the corresponding provider update is persisted. */
  async claim(
    platform: string,
    applicationId: string,
    code: string,
  ): Promise<OwnerBindingClaimResult> {
    try {
      const redis = await getRedisServiceClient('ownerBinding');
      if (!redis) return 'unavailable';

      const result = await redis.eval<number>(
        CLAIM_SCRIPT,
        1,
        RedisKeys.ownerBinding.code(platform, applicationId),
        code,
      );
      return result === 1 ? 'claimed' : result === 0 ? 'invalid' : 'unavailable';
    } catch (error) {
      console.error('[redis:owner-binding] Failed to claim code:', error);
      return 'unavailable';
    }
  },

  /** Consume the claimed code after the provider update has succeeded. */
  async complete(
    platform: string,
    applicationId: string,
    code: string,
  ): Promise<OwnerBindingCompleteResult> {
    try {
      const redis = await getRedisServiceClient('ownerBinding');
      if (!redis) return 'unavailable';

      const result = await redis.eval<number>(
        COMPLETE_SCRIPT,
        1,
        RedisKeys.ownerBinding.code(platform, applicationId),
        code,
      );
      return result === 1 ? 'consumed' : 'invalid';
    } catch (error) {
      console.error('[redis:owner-binding] Failed to complete code:', error);
      return 'unavailable';
    }
  },

  /** Release a claimed code if the provider update failed. */
  async release(platform: string, applicationId: string, code: string): Promise<void> {
    try {
      const redis = await getRedisServiceClient('ownerBinding');
      if (!redis) return;

      await redis.eval<number>(
        RELEASE_SCRIPT,
        1,
        RedisKeys.ownerBinding.code(platform, applicationId),
        code,
      );
    } catch (error) {
      console.error('[redis:owner-binding] Failed to release code claim:', error);
    }
  },
};
