import debug from 'debug';
import type { Context } from 'hono';
import { z } from 'zod';

import { invalidateMessengerConfigCache, type MessengerPlatform } from '@/config/messenger';
import { getServerDB } from '@/database/core/db-adaptor';
import { SystemBotProviderModel } from '@/database/models/systemBotProvider';
import { gatewayEnv } from '@/envs/gateway';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

const log = debug('lobe-server:agent:system-bot-provider');

/**
 * Deployment-level SystemBot (messenger) providers.
 *
 * Credentials arrive as **plaintext JSON** and are encrypted by
 * `SystemBotProviderModel`, so the `iv:authTag:ciphertext` format stays owned by
 * this process — callers never produce ciphertext, and the read side never
 * returns it.
 *
 * Authenticated with `MESSAGE_GATEWAY_SERVICE_TOKEN`, the inline pattern used by
 * `/gateway/callback`. Callers are deployment-side provisioners that already
 * hold that token to drive the message gateway, so provisioning adds no new
 * credential to distribute.
 */

const MESSENGER_PLATFORMS = [
  'discord',
  'linq',
  'slack',
  'telegram',
  'wechat',
] as const satisfies readonly MessengerPlatform[];

const UpsertSchema = z.object({
  applicationId: z.string().nullish(),
  /**
   * The full desired credential bundle for the platform (`{}` for WeChat, whose
   * credentials are issued per user by QR scan). Partial updates are not
   * supported: a provisioner expresses "leave this platform alone" by omitting
   * it from its declaration, so sending half a bundle could only ever mean it
   * meant to wipe the other half.
   */
  credentials: z.record(z.string(), z.any()),
  enabled: z.boolean().optional(),
  platform: z.enum(MESSENGER_PLATFORMS),
});

/** Shared token check; returns the response to short-circuit with, or null. */
const authorize = (c: Context): Response | null => {
  const serviceToken = gatewayEnv.MESSAGE_GATEWAY_SERVICE_TOKEN;
  if (!serviceToken) return c.json({ error: 'Service not configured' }, 503);
  if (c.req.header('authorization') !== `Bearer ${serviceToken}`) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  return null;
};

/** POST /api/agent/system-bots — upsert one platform's provider row. */
export async function upsertSystemBotProvider(c: Context): Promise<Response> {
  const denied = authorize(c);
  if (denied) return denied;

  let parsed;
  try {
    parsed = UpsertSchema.safeParse(await c.req.json());
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }
  if (!parsed.success) {
    return c.json({ error: 'Invalid body', issues: parsed.error.issues }, 400);
  }

  const { applicationId, credentials, enabled, platform } = parsed.data;

  // Without the vault key the model would fall back to writing the credentials
  // as plain JSON — a row that every reader then fails to decrypt, which shows
  // up as a silently disabled platform. Refuse instead.
  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey().catch(() => null);
  if (!gateKeeper) {
    return c.json({ error: 'KEY_VAULTS_SECRET is not configured' }, 503);
  }

  const serverDB = await getServerDB();
  const row = await SystemBotProviderModel.upsertByPlatform(
    serverDB,
    { applicationId: applicationId ?? null, credentials, enabled: enabled ?? true, platform },
    gateKeeper,
  );

  // The runtime caches a platform's config for 30s. Drop it so a rotation is
  // live on the next request instead of after the TTL.
  invalidateMessengerConfigCache(platform);

  log('upserted %s (enabled=%s)', platform, row.enabled);

  return c.json({ applicationId: row.applicationId, enabled: row.enabled, ok: true, platform });
}

/** GET /api/agent/system-bots — list providers, never their credentials. */
export async function listSystemBotProviders(c: Context): Promise<Response> {
  const denied = authorize(c);
  if (denied) return denied;

  const serverDB = await getServerDB();
  const rows = await SystemBotProviderModel.listSummaries(serverDB);

  return c.json({
    platforms: rows.map(({ applicationId, enabled, platform, updatedAt }) => ({
      applicationId,
      enabled,
      platform,
      updatedAt,
    })),
  });
}
