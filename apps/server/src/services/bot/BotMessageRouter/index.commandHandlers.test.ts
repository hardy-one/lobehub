import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AiAgentService } from '@/server/services/aiAgent';

import { AgentBridgeService } from '../AgentBridgeService';
import {
  renderCommandReply,
  renderFeedbackSubmitted,
  renderOwnerBindingReply,
} from '../replyTemplate';
import { BotMessageRouter } from './index';
import {
  FAKE_DB,
  makeProvider,
  mockDeletePairingRequest,
  mockFindEnabledByPlatform,
  mockGetMessenger,
  mockGetPlatform,
  mockOnNewMessage,
  mockOnSlashCommand,
  mockPeekPairingRequest,
  mockProviderFindById,
  mockProviderUpdate,
  resetBotMessageRouterMocks,
} from './testUtils';

const mockSubmitBotFeedback = vi.hoisted(() => vi.fn());
const mockClaimOwnerBindingCode = vi.hoisted(() => vi.fn());
const mockCompleteOwnerBindingCode = vi.hoisted(() => vi.fn());
const mockReleaseOwnerBindingCode = vi.hoisted(() => vi.fn());
vi.mock('../feedbackSubmit', () => ({ submitBotFeedback: mockSubmitBotFeedback }));
vi.mock('../ownerBindingStore', () => ({
  claimOwnerBindingCode: mockClaimOwnerBindingCode,
  completeOwnerBindingCode: mockCompleteOwnerBindingCode,
  releaseOwnerBindingCode: mockReleaseOwnerBindingCode,
}));
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

/**
 * Characterization of the command handlers built by the router: `/stop`,
 * `/feedback`, the native slash-command context (ephemeral replies) and the
 * platform command-menu registration. Driven through the public webhook entry
 * and the handlers it registers on the (mocked) Chat SDK instance.
 */

const EN = 'en-US';

/** Static registry API the `/stop` handler reads from AgentBridgeService. */
const bridgeStatics = {
  clearActiveThread: vi.fn(),
  getActiveOperationId: vi.fn(),
  isThreadActive: vi.fn(),
  requestStop: vi.fn(),
};

async function loadCommandHandlers(settings: Record<string, unknown> = {}, platform = 'telegram') {
  mockFindEnabledByPlatform.mockResolvedValue([
    makeProvider({ id: 'provider-1', applicationId: 'app-1', platform, settings }),
  ]);
  const router = new BotMessageRouter();
  await router.getWebhookHandler(
    platform,
    'app-1',
  )(new Request('https://example.com/webhook', { body: '{}', method: 'POST' }));
  const textCall = mockOnNewMessage.mock.calls.find(
    (call) => call[0] instanceof RegExp && call[0].source.includes('feedback'),
  );
  if (!textCall) throw new Error('text command handler not registered');
  const slash = (name: string) => {
    const call = mockOnSlashCommand.mock.calls.find((c) => c[0] === `/${name}`);
    if (!call) throw new Error(`/${name} not registered`);
    return call[1] as (event: any) => Promise<void>;
  };
  return {
    slash,
    text: textCall[1] as (thread: any, message: any) => Promise<void>,
  };
}

function makeThread() {
  return {
    id: 'telegram:chat-1',
    isDM: true,
    post: vi.fn().mockResolvedValue(undefined),
    setState: vi.fn().mockResolvedValue(undefined),
    state: Promise.resolve(null),
  };
}

function makeMessage(text: string) {
  return { author: { isBot: false, userId: 'alice-id', userName: 'alice' }, text };
}

function makeSlashEvent(text: string, withUser = true) {
  const channel = {
    id: 'telegram:chat-1',
    isDM: true,
    post: vi.fn().mockResolvedValue(undefined),
    postEphemeral: vi.fn().mockResolvedValue(undefined),
    setState: vi.fn().mockResolvedValue(undefined),
    state: Promise.resolve(null),
  };
  const user = withUser ? { isBot: false, userId: 'alice-id', userName: 'alice' } : undefined;
  return { channel, event: { channel, text, user }, user };
}

describe('BotMessageRouter command handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetBotMessageRouterMocks();
    mockClaimOwnerBindingCode.mockResolvedValue('invalid');
    mockCompleteOwnerBindingCode.mockResolvedValue('consumed');
    mockReleaseOwnerBindingCode.mockResolvedValue(undefined);
    Object.assign(AgentBridgeService, bridgeStatics);
    bridgeStatics.isThreadActive.mockReturnValue(true);
    bridgeStatics.getActiveOperationId.mockReturnValue(undefined);
  });

  afterEach(() => {
    for (const key of Object.keys(bridgeStatics)) {
      delete (AgentBridgeService as unknown as Record<string, unknown>)[key];
    }
  });

  describe('/stop', () => {
    it('replies "not active" when the thread has no run', async () => {
      bridgeStatics.isThreadActive.mockReturnValue(false);
      const { text } = await loadCommandHandlers();
      const thread = makeThread();

      await text(thread, makeMessage('/stop'));

      expect(bridgeStatics.isThreadActive).toHaveBeenCalledWith('telegram:chat-1');
      expect(thread.post).toHaveBeenCalledWith(renderCommandReply('cmdStopNotActive', EN));
      expect(bridgeStatics.requestStop).not.toHaveBeenCalled();
    });

    it('queues a deferred stop while the run has no operation id yet', async () => {
      const { text } = await loadCommandHandlers();
      const thread = makeThread();

      await text(thread, makeMessage('/stop'));

      expect(bridgeStatics.requestStop).toHaveBeenCalledWith('telegram:chat-1');
      expect(AiAgentService).not.toHaveBeenCalled();
      expect(thread.post).toHaveBeenCalledWith(renderCommandReply('cmdStopRequested', EN));
    });

    it('interrupts the tracked operation and clears the active thread', async () => {
      bridgeStatics.getActiveOperationId.mockReturnValue('op-1');
      const interruptTask = vi.fn().mockResolvedValue({ success: true });
      vi.mocked(AiAgentService).mockImplementationOnce(function () {
        return { interruptTask } as any;
      });
      const { text } = await loadCommandHandlers();
      const thread = makeThread();

      await text(thread, makeMessage('/stop'));

      expect(AiAgentService).toHaveBeenCalledWith(FAKE_DB, 'user-1', { workspaceId: undefined });
      expect(interruptTask).toHaveBeenCalledWith({ operationId: 'op-1' });
      expect(bridgeStatics.clearActiveThread).toHaveBeenCalledWith('telegram:chat-1');
      expect(bridgeStatics.requestStop).not.toHaveBeenCalled();
      expect(thread.post).toHaveBeenCalledWith(renderCommandReply('cmdStopRequested', EN));
    });

    it.each([
      ['the runtime rejects the interrupt', () => vi.fn().mockResolvedValue({ success: false })],
      ['the interrupt throws', () => vi.fn().mockRejectedValue(new Error('boom'))],
    ])('replies "unable" when %s', async (_label, makeInterrupt) => {
      bridgeStatics.getActiveOperationId.mockReturnValue('op-1');
      const interruptTask = makeInterrupt();
      vi.mocked(AiAgentService).mockImplementationOnce(function () {
        return { interruptTask } as any;
      });
      const { text } = await loadCommandHandlers();
      const thread = makeThread();

      await text(thread, makeMessage('/stop'));

      expect(bridgeStatics.clearActiveThread).not.toHaveBeenCalled();
      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(thread.post).toHaveBeenCalledWith(renderCommandReply('cmdStopUnable', EN));
    });
  });

  describe('/feedback', () => {
    it('replies privately on native slash commands and submits the body', async () => {
      mockSubmitBotFeedback.mockResolvedValue({
        issueUrl: 'https://example.com/i/1',
        success: true,
      });
      const { slash } = await loadCommandHandlers();
      const { channel, event, user } = makeSlashEvent('  the app is slow  ');

      await slash('feedback')(event);

      expect(mockSubmitBotFeedback).toHaveBeenCalledWith(FAKE_DB, {
        applicationId: 'app-1',
        body: 'the app is slow',
        platform: 'telegram',
        threadId: 'telegram:chat-1',
        userId: 'user-1',
      });
      expect(channel.postEphemeral).toHaveBeenCalledWith(
        user,
        renderFeedbackSubmitted('https://example.com/i/1', EN),
        { fallbackToDM: true },
      );
      expect(channel.post).not.toHaveBeenCalled();
    });

    it('falls back to a channel post when the slash event carries no user', async () => {
      mockSubmitBotFeedback.mockResolvedValue({ success: true });
      const { slash } = await loadCommandHandlers();
      const { channel, event } = makeSlashEvent('hello', false);

      await slash('feedback')(event);

      expect(channel.postEphemeral).not.toHaveBeenCalled();
      expect(channel.post).toHaveBeenCalledWith(renderFeedbackSubmitted(undefined, EN));
    });

    it.each([
      ['an empty body', '/feedback', undefined, 'cmdFeedbackUsage'],
      ['a failed submission', '/feedback broken', { success: false }, 'cmdFeedbackError'],
    ] as const)('replies with usage / error copy for %s', async (_label, input, result, key) => {
      if (result) mockSubmitBotFeedback.mockResolvedValue(result);
      const { text } = await loadCommandHandlers();
      const thread = makeThread();

      await text(thread, makeMessage(input));

      expect(mockSubmitBotFeedback).toHaveBeenCalledTimes(result ? 1 : 0);
      expect(thread.post).toHaveBeenCalledWith(renderCommandReply(key, EN));
    });
  });

  describe('native slash-command context', () => {
    it('passes the slash text as args and wires channel state to the handler', async () => {
      const { slash } = await loadCommandHandlers();
      const { channel, event } = makeSlashEvent('chat');

      await slash('mode')(event);

      expect(channel.setState).toHaveBeenCalledWith({ toolMode: 'chat' }, undefined);
      expect(channel.post).toHaveBeenCalledWith(renderCommandReply('cmdModeSetChat', EN));
    });
  });

  describe('platform command menu', () => {
    function withRegisterBotCommands(registerBotCommands: ReturnType<typeof vi.fn>) {
      const base = mockGetPlatform.getMockImplementation()!;
      mockGetPlatform.mockImplementation(function (platform: string) {
        const entry = base(platform);
        if (!entry) return entry;
        const createClient = entry.clientFactory.createClient;
        return {
          ...entry,
          clientFactory: {
            createClient: (...args: unknown[]) => ({
              ...createClient(...args),
              registerBotCommands,
            }),
          },
        };
      });
      return () => mockGetPlatform.mockImplementation(base);
    }

    it('registers every command with its description and options', async () => {
      const registerBotCommands = vi.fn().mockResolvedValue(undefined);
      const restore = withRegisterBotCommands(registerBotCommands);
      try {
        await loadCommandHandlers();
      } finally {
        restore();
      }

      expect(registerBotCommands).toHaveBeenCalledTimes(1);
      const list = registerBotCommands.mock.calls[0][0] as Array<Record<string, unknown>>;
      expect(list.map((c) => c.command)).toEqual([
        'new',
        'mode',
        'stop',
        'approve',
        'feedback',
        'whoami',
      ]);
      expect(list.find((c) => c.command === 'approve')).toEqual({
        command: 'approve',
        description: 'Approve a pairing request: /approve <code>',
        options: [
          {
            description: 'The 8-character pairing code shown to the applicant',
            name: 'code',
            required: true,
          },
        ],
      });
      expect(list.find((c) => c.command === 'new')?.options).toBeUndefined();
    });

    it('still loads the bot when menu registration rejects', async () => {
      const registerBotCommands = vi.fn().mockRejectedValue(new Error('menu down'));
      const restore = withRegisterBotCommands(registerBotCommands);
      try {
        const { slash } = await loadCommandHandlers();
        expect(slash('stop')).toBeTypeOf('function');
      } finally {
        restore();
      }
      expect(registerBotCommands).toHaveBeenCalledTimes(1);
    });
  });
  describe('QQ owner binding and group approval', () => {
    it('persists /bind owner identity and consumes the private code', async () => {
      mockClaimOwnerBindingCode.mockResolvedValueOnce('claimed');
      mockCompleteOwnerBindingCode.mockResolvedValueOnce('consumed');
      mockProviderFindById.mockResolvedValue({
        applicationId: 'app-1',
        platform: 'qq',
        settings: {
          allowFrom: [{ id: 'approved-c2c', name: 'Friend' }],
          dmPolicy: 'pairing',
          groupAllowFrom: [{ id: 'approved-group', name: 'Team' }],
        },
      });
      const { text } = await loadCommandHandlers({ dmPolicy: 'pairing' }, 'qq');
      const thread = makeThread();
      const message = {
        ...makeMessage('/bind ABCD2345'),
        author: { isBot: false, userId: 'qq-user-openid', userName: 'owner' },
      };

      await text(thread, message);

      expect(mockClaimOwnerBindingCode).toHaveBeenCalledWith({
        applicationId: 'app-1',
        code: 'ABCD2345',
        platform: 'qq',
      });
      expect(mockProviderUpdate).toHaveBeenCalledWith(
        'provider-1',
        expect.objectContaining({
          settings: expect.objectContaining({
            allowFrom: [{ id: 'approved-c2c', name: 'Friend' }],
            groupAllowFrom: [{ id: 'approved-group', name: 'Team' }],
            userId: 'qq-user-openid',
          }),
        }),
      );
      expect(mockCompleteOwnerBindingCode).toHaveBeenCalledWith({
        applicationId: 'app-1',
        code: 'ABCD2345',
        platform: 'qq',
      });
      expect(thread.post).toHaveBeenCalledWith(renderOwnerBindingReply('success', 'zh-CN'));
    });

    it('rejects /bind in a group before checking whether the code is valid', async () => {
      const { text } = await loadCommandHandlers({ dmPolicy: 'open' }, 'qq');
      const thread = { ...makeThread(), isDM: false };

      await text(thread, makeMessage('/bind wrong-code'));

      expect(mockClaimOwnerBindingCode).not.toHaveBeenCalled();
      expect(thread.post).toHaveBeenCalledWith(renderOwnerBindingReply('dm-only', 'zh-CN'));
    });
    it('shows a fresh-code action for an invalid QQ binding code', async () => {
      mockClaimOwnerBindingCode.mockResolvedValueOnce('invalid');
      const { text } = await loadCommandHandlers({ dmPolicy: 'open' }, 'qq');
      const thread = makeThread();

      await text(thread, makeMessage('/bind BADCODE'));

      expect(thread.post).toHaveBeenCalledWith(renderOwnerBindingReply('code-invalid', 'zh-CN'));
      expect(mockProviderUpdate).not.toHaveBeenCalled();
    });

    it('explains Redis unavailability for QQ owner binding', async () => {
      mockClaimOwnerBindingCode.mockResolvedValueOnce('redis-unavailable');
      const { text } = await loadCommandHandlers({ dmPolicy: 'open' }, 'qq');
      const thread = makeThread();

      await text(thread, makeMessage('/bind ABCD2345'));

      expect(thread.post).toHaveBeenCalledWith(renderOwnerBindingReply('unavailable', 'zh-CN'));
      expect(mockProviderUpdate).not.toHaveBeenCalled();
    });

    it('keeps the binding code available when provider persistence fails', async () => {
      mockClaimOwnerBindingCode.mockResolvedValueOnce('claimed');
      mockProviderFindById.mockResolvedValueOnce(undefined);
      const { text } = await loadCommandHandlers({ dmPolicy: 'open' }, 'qq');
      const thread = makeThread();

      await text(thread, makeMessage('/bind ABCD2345'));

      expect(mockReleaseOwnerBindingCode).toHaveBeenCalledWith({
        applicationId: 'app-1',
        code: 'ABCD2345',
        platform: 'qq',
      });
      expect(mockCompleteOwnerBindingCode).not.toHaveBeenCalled();
      expect(thread.post).toHaveBeenCalledWith(renderOwnerBindingReply('save-failed', 'zh-CN'));
    });

    it('reports when the saved binding code could not be cleared', async () => {
      mockClaimOwnerBindingCode.mockResolvedValueOnce('claimed');
      mockCompleteOwnerBindingCode.mockResolvedValueOnce('redis-unavailable');
      mockProviderFindById.mockResolvedValueOnce({
        applicationId: 'app-1',
        platform: 'qq',
        settings: {},
      });
      const { text } = await loadCommandHandlers({ dmPolicy: 'open' }, 'qq');
      const thread = makeThread();

      await text(thread, makeMessage('/bind ABCD2345'));

      expect(thread.post).toHaveBeenCalledWith(renderOwnerBindingReply('cleanup-failed', 'zh-CN'));
    });

    it('approves a group code into groupAllowFrom and notifies its original thread', async () => {
      const entry = {
        applicantUserId: 'group-openid',
        applicantUserName: 'Team Group',
        applicationId: 'app-1',
        code: 'GROUP123',
        createdAt: 1_700_000_000_000,
        platform: 'qq',
        replyLocale: 'en-US',
        scope: 'group' as const,
        targetChannelId: 'group-openid',
        threadId: 'qq:group:group-openid',
      };
      mockPeekPairingRequest.mockResolvedValueOnce(entry);
      mockProviderFindById.mockResolvedValueOnce({
        applicationId: 'app-1',
        platform: 'qq',
        settings: {
          allowFrom: [{ id: 'existing-user', name: 'Friend' }],
          groupAllowFrom: [{ id: 'existing-group', name: 'Existing group' }],
        },
      });
      const { text } = await loadCommandHandlers(
        { groupPolicy: 'pairing', userId: 'qq-owner-openid' },
        'qq',
      );
      const thread = makeThread();
      const message = {
        ...makeMessage('/approve GROUP123'),
        author: { isBot: false, userId: 'qq-owner-openid', userName: 'owner' },
      };

      await text(thread, message);

      expect(mockProviderUpdate).toHaveBeenCalledWith(
        'provider-1',
        expect.objectContaining({
          settings: expect.objectContaining({
            allowFrom: [{ id: 'existing-user', name: 'Friend' }],
            groupAllowFrom: [
              { id: 'existing-group', name: 'Existing group' },
              { id: 'group-openid', name: 'Team Group' },
            ],
          }),
        }),
      );
      expect(mockDeletePairingRequest).toHaveBeenCalledWith(
        expect.objectContaining({ applicantUserId: 'group-openid', scope: 'group' }),
      );
      expect(mockGetMessenger).toHaveBeenCalledWith('qq:group:group-openid');
    });
  });
});
