import { redisService } from '@/server/services/redis';

import { OWNER_BINDING_TTL_SECONDS } from '../redis/ownerBinding';
import { generatePairingCode } from './dmPairingStore';

/** One current 15-minute code per bot, stored at `bot:owner-binding:<platform>:<applicationId>`. */
export { OWNER_BINDING_TTL_SECONDS };

export type CreateOwnerBindingCodeResult =
  { code: string; expiresAt: number; status: 'created' } | { status: 'redis-unavailable' };

export async function createOwnerBindingCode(params: {
  applicationId: string;
  platform: string;
}): Promise<CreateOwnerBindingCodeResult> {
  const { applicationId, platform } = params;
  const code = generatePairingCode();
  const expiresAt = await redisService.ownerBinding.issue(platform, applicationId, code);
  if (expiresAt === null) return { status: 'redis-unavailable' };

  return { code, expiresAt, status: 'created' };
}

export type ClaimOwnerBindingCodeResult = 'claimed' | 'invalid' | 'redis-unavailable';
export type CompleteOwnerBindingCodeResult = 'consumed' | 'invalid' | 'redis-unavailable';

/** Validate and claim the current code while `settings.userId` is persisted. */
export async function claimOwnerBindingCode(params: {
  applicationId: string;
  code: string;
  platform: string;
}): Promise<ClaimOwnerBindingCodeResult> {
  const { applicationId, code, platform } = params;
  const normalizedCode = code.trim().toUpperCase();
  if (!normalizedCode) return 'invalid';

  const result = await redisService.ownerBinding.claim(platform, applicationId, normalizedCode);
  return result === 'unavailable' ? 'redis-unavailable' : result;
}

/** Consume the code after the provider update has succeeded. */
export async function completeOwnerBindingCode(params: {
  applicationId: string;
  code: string;
  platform: string;
}): Promise<CompleteOwnerBindingCodeResult> {
  const { applicationId, code, platform } = params;
  const normalizedCode = code.trim().toUpperCase();
  if (!normalizedCode) return 'invalid';

  const result = await redisService.ownerBinding.complete(platform, applicationId, normalizedCode);
  return result === 'unavailable' ? 'redis-unavailable' : result;
}

/** Leave the code valid if the provider update failed. */
export async function releaseOwnerBindingCode(params: {
  applicationId: string;
  code: string;
  platform: string;
}): Promise<void> {
  const { applicationId, code, platform } = params;
  const normalizedCode = code.trim().toUpperCase();
  if (!normalizedCode) return;

  await redisService.ownerBinding.release(platform, applicationId, normalizedCode);
}
