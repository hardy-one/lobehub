import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BotMessageRouter } from './index';
import {
  makeProvider,
  mockFindEnabledByPlatform,
  mockInitialize,
  mockShutdown,
  resetBotMessageRouterMocks,
} from './testUtils';

vi.mock('@/database/core/db-adaptor', async () => (await import('./testUtils')).dbAdaptorModule());
vi.mock('@/database/models/agentBotProvider', async () =>
  (await import('./testUtils')).agentBotProviderModule(),
);
vi.mock('../dmPairingStore', async () => (await import('./testUtils')).dmPairingStoreModule());
vi.mock('@/server/modules/KeyVaultsEncrypt', async () =>
  (await import('./testUtils')).keyVaultsEncryptModule(),
);
vi.mock('@/server/modules/AgentRuntime/redis', async () =>
  (await import('./testUtils')).redisModule(),
);
vi.mock('@/business/server/bot/featureAccess', async () =>
  (await import('./testUtils')).featureAccessModule(),
);
vi.mock('@/envs/app', async () => (await import('./testUtils')).appModule());
vi.mock('@chat-adapter/state-ioredis', async () =>
  (await import('./testUtils')).stateIoredisModule(),
);
vi.mock('chat', async () => (await import('./testUtils')).chatModule());
vi.mock('../deferredMessages', async () => (await import('./testUtils')).deferredMessagesModule());
vi.mock('../mergeMessages', async (importOriginal) =>
  (await import('./testUtils')).mergeMessagesModule(importOriginal),
);
vi.mock('@/server/services/aiAgent', async () => (await import('./testUtils')).aiAgentModule());
vi.mock('../AgentBridgeService', async () =>
  (await import('./testUtils')).agentBridgeServiceModule(),
);
vi.mock('../platforms', async () => (await import('./testUtils')).platformsModule());

const post = () => new Request('https://example.com/webhook', { body: '{}', method: 'POST' });

/** A minimal RegisteredBot whose Chat is a fake exposing a shutdown spy. */
const fakeBot = () => {
  const shutdown = vi.fn().mockResolvedValue(undefined);
  return {
    bot: {
      adapters: {},
      agentInfo: { agentId: 'agent-1', userId: 'user-1' },
      chatBot: { shutdown } as any,
      client: {} as any,
    },
    shutdown,
  };
};

describe('BotMessageRouter.invalidateBot — graceful shutdown of cached instances', () => {
  const KEY = 'telegram:app-123';
  const PLATFORM = 'telegram';
  const APP_ID = 'app-123';

  beforeEach(() => {
    vi.clearAllMocks();
    resetBotMessageRouterMocks();
  });

  it('calls chatBot.shutdown() on the cached instance and evicts it', async () => {
    const router = new BotMessageRouter();
    const { bot, shutdown } = fakeBot();
    (router as any).bots.set(KEY, bot);

    await router.invalidateBot(PLATFORM, APP_ID);

    expect(shutdown).toHaveBeenCalledTimes(1);
    expect((router as any).bots.has(KEY)).toBe(false);
  });

  it('is a no-op when no bot is cached for the key', async () => {
    const router = new BotMessageRouter();

    await expect(router.invalidateBot(PLATFORM, APP_ID)).resolves.toBeUndefined();

    expect(mockShutdown).not.toHaveBeenCalled();
    expect((router as any).bots.has(KEY)).toBe(false);
  });

  it('wires the real load → invalidate path to shutdown the cached Chat', async () => {
    // Integration regression: a bot created by the on-demand loader must be
    // the exact instance invalidateBot shuts down (fake Chat from chatModule).
    mockFindEnabledByPlatform.mockResolvedValue([makeProvider({ applicationId: APP_ID })]);
    const router = new BotMessageRouter();
    await router.getWebhookHandler(PLATFORM, APP_ID)(post());
    expect((router as any).bots.has(KEY)).toBe(true);

    await router.invalidateBot(PLATFORM, APP_ID);

    expect(mockShutdown).toHaveBeenCalledTimes(1);
    expect((router as any).bots.has(KEY)).toBe(false);
  });

  it('shuts down the previous instance when the same key is re-registered', async () => {
    const router = new BotMessageRouter();
    const { bot: previous, shutdown: previousShutdown } = fakeBot();
    (router as any).bots.set(KEY, previous);

    // Force a fresh load that overwrites the cached entry (createAndRegisterBot
    // calls bots.set under the same key).
    mockFindEnabledByPlatform.mockResolvedValue([makeProvider({ applicationId: APP_ID })]);
    await (router as any).loadBot(PLATFORM, APP_ID);

    expect(previousShutdown).toHaveBeenCalledTimes(1);
    const registered = (router as any).bots.get(KEY);
    expect(registered).toBeDefined();
    expect(registered).not.toBe(previous);
  });

  it('still evicts the bot and resolves when shutdown rejects', async () => {
    const router = new BotMessageRouter();
    const { bot, shutdown } = fakeBot();
    shutdown.mockRejectedValueOnce(new Error('state adapter disconnect failed'));
    (router as any).bots.set(KEY, bot);

    await expect(router.invalidateBot(PLATFORM, APP_ID)).resolves.toBeUndefined();

    expect(shutdown).toHaveBeenCalledTimes(1);
    expect((router as any).bots.has(KEY)).toBe(false);
  });

  it('deduplicates concurrent loads so no extra instance is created or leaked', async () => {
    // Hold the first load at the provider lookup so a second webhook joins the
    // same in-flight promise (the getOrCreateBot dedup path).
    let releaseProviders!: (value: unknown[]) => void;
    const providersGate = new Promise<unknown[]>((resolve) => {
      releaseProviders = resolve;
    });
    mockFindEnabledByPlatform.mockReturnValue(providersGate);

    const router = new BotMessageRouter();
    const handler = router.getWebhookHandler(PLATFORM, APP_ID);
    const first = handler(post());
    const second = handler(post());
    await vi.waitFor(() => expect(mockFindEnabledByPlatform).toHaveBeenCalledTimes(1));

    releaseProviders([makeProvider({ applicationId: APP_ID })]);
    await Promise.all([first, second]);

    // Exactly one Chat instance is created — the dedup never drops a second one.
    expect(mockInitialize).toHaveBeenCalledTimes(1);
    expect((router as any).bots.has(KEY)).toBe(true);

    // Invalidating it shuts down that single instance, so no socket is leaked.
    await router.invalidateBot(PLATFORM, APP_ID);
    expect(mockShutdown).toHaveBeenCalledTimes(1);
    expect((router as any).bots.has(KEY)).toBe(false);
  });

  it('reaches an adapter disconnect() through Chat#shutdown (QQ-shaped adapter)', async () => {
    // Basis for relying on chatBot.shutdown(): the SDK's Chat#shutdown() walks
    // its adapters and awaits `adapter.disconnect()` for any adapter that
    // implements it (see chat's Chat.prototype.shutdown + optional
    // Adapter.disconnect hook). Drive the REAL Chat class here (the module is
    // mocked above for the router) to prove our single shutdown() call closes
    // a QQ-style adapter connection instead of only touching the map.
    const chatSdk = (await vi.importActual('chat')) as { Chat: new (config: any) => unknown };
    const RealChat = chatSdk.Chat;
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const stateDisconnect = vi.fn().mockResolvedValue(undefined);
    const qqAdapter = { disconnect, name: 'qq' };
    const realChat = new RealChat({
      adapters: { qq: qqAdapter },
      logger: { debug() {}, error() {}, info() {}, warn() {} },
      state: { disconnect: stateDisconnect },
      userName: 'test-qq-bot',
    } as any);

    const router = new BotMessageRouter();
    const qqKey = 'qq:qq-app-1';
    (router as any).bots.set(qqKey, {
      adapters: { qq: qqAdapter },
      agentInfo: { agentId: 'agent-1', userId: 'user-1' },
      chatBot: realChat,
      client: {} as any,
    });

    await router.invalidateBot('qq', 'qq-app-1');

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(stateDisconnect).toHaveBeenCalledTimes(1);
    expect((router as any).bots.has(qqKey)).toBe(false);
  });
});
