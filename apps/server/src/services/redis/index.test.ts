import { beforeEach, describe, expect, it, vi } from 'vitest';

import { redisService } from './index';

const { del, evalScript, get, getRedisServiceClient, set } = vi.hoisted(() => {
  const client = {
    del: vi.fn(),
    eval: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
  };
  return {
    ...client,
    evalScript: client.eval,
    getRedisServiceClient: vi.fn(async () => client),
  };
});
vi.mock('./client', () => ({ getRedisServiceClient }));

describe('Redis domain service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    get.mockResolvedValue(null);
    set.mockResolvedValue('OK');
    evalScript.mockResolvedValue(1);
  });

  it('isolates device answers by principal pool and preserves the requested freshness', async () => {
    const fetch = vi.fn().mockResolvedValue({ arch: 'arm64' });
    await redisService.deviceSystemInfo.remember(
      { deviceId: 'd', userId: 'u', workspaceId: 'w' },
      fetch,
      1000,
    );
    expect(set).toHaveBeenCalledWith(
      'device_system_info:v1:u:w:d',
      JSON.stringify({ arch: 'arm64' }),
      { px: 1000 },
    );
    get.mockResolvedValue(JSON.stringify({ arch: 'arm64' }));
    await redisService.deviceSystemInfo.remember(
      { deviceId: 'd', userId: 'u', workspaceId: 'w' },
      fetch,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not retain empty or static skill discoveries and scopes successful reads to the connection', async () => {
    const scope = {
      connection: { createdAt: 'date', providerUserId: 'account' },
      providerId: 'github',
      userId: 'u',
    };
    await redisService.skillTools.remember(scope, async () => ({ source: 'live', tools: [] }));
    expect(set).not.toHaveBeenCalled();
    // The static fallback is served when the live probe failed; it must not be
    // pinned for the TTL, or later sends stop retrying live discovery.
    await redisService.skillTools.remember(scope, async () => ({
      source: 'static',
      tools: ['tool'],
    }));
    expect(set).not.toHaveBeenCalled();
    await redisService.skillTools.remember(scope, async () => ({
      source: 'live',
      tools: ['tool'],
    }));
    expect(set).toHaveBeenCalledWith(
      'lobehub_skill_tools:v1:u:github:date|account',
      JSON.stringify({ source: 'live', tools: ['tool'] }),
      { px: 600_000 },
    );
  });

  it('stores owner binding codes under the bot namespace with a fifteen-minute expiry', async () => {
    const expiresAt = await redisService.ownerBinding.issue('qq', 'app-1', 'ABCD2345');

    expect(expiresAt).toBeGreaterThan(Date.now());
    expect(set).toHaveBeenCalledWith(
      'owner-binding:qq:app-1',
      JSON.stringify({ claimed: false, code: 'ABCD2345' }),
      { ex: 900 },
    );
    expect(getRedisServiceClient).toHaveBeenCalledWith('ownerBinding');
  });

  it('claims a matching owner code atomically and rejects a mismatch', async () => {
    await expect(redisService.ownerBinding.claim('qq', 'app-1', 'ABCD2345')).resolves.toBe(
      'claimed',
    );
    expect(evalScript).toHaveBeenCalledWith(
      expect.stringContaining('state.claimed = true'),
      1,
      'owner-binding:qq:app-1',
      'ABCD2345',
    );

    evalScript.mockResolvedValueOnce(0);
    await expect(redisService.ownerBinding.claim('qq', 'app-1', 'WRONG')).resolves.toBe('invalid');
  });

  it('consumes a claimed code after persistence and releases claims on failure', async () => {
    await expect(redisService.ownerBinding.complete('qq', 'app-1', 'ABCD2345')).resolves.toBe(
      'consumed',
    );
    expect(evalScript).toHaveBeenCalledWith(
      expect.stringContaining('not state.claimed'),
      1,
      'owner-binding:qq:app-1',
      'ABCD2345',
    );

    await redisService.ownerBinding.release('qq', 'app-1', 'ABCD2345');
    expect(evalScript).toHaveBeenLastCalledWith(
      expect.stringContaining('state.claimed = false'),
      1,
      'owner-binding:qq:app-1',
      'ABCD2345',
    );
  });
  it('grants a rescan only to the winner of the atomic directory claim', async () => {
    const scope = { cwd: '/project', deviceId: 'd', userId: 'u' };
    expect(await redisService.workspaceRescan.claim(scope)).toBe(true);
    set.mockResolvedValue(null);
    expect(await redisService.workspaceRescan.claim(scope)).toBe(false);
    expect(set).toHaveBeenCalledWith('workspace_rescan_claim:v1:u:personal:d:/project', '1', {
      nx: true,
      px: 45_000,
    });
  });

  it('claims one webhook delivery per provider event id across instances, and releases it', async () => {
    set.mockResolvedValueOnce('OK').mockResolvedValueOnce(null);
    const scope = { eventId: 'evt_1', provider: 'agent-mail' };

    await expect(redisService.agentIdentity.claimWebhookEvent(scope, 86_400)).resolves.toBe(true);
    await expect(redisService.agentIdentity.claimWebhookEvent(scope, 86_400)).resolves.toBe(false);
    expect(set).toHaveBeenCalledWith('webhook_event:v1:agent-mail:evt_1', '1', {
      nx: true,
      px: 86_400_000,
    });

    del.mockResolvedValue(1);
    await redisService.agentIdentity.releaseWebhookEvent(scope);
    expect(del).toHaveBeenCalledWith('webhook_event:v1:agent-mail:evt_1');
  });
});
