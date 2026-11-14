import type { Chat } from 'chat';
import debug from 'debug';

import { AgentModel } from '@/database/models/agent';
import { AgentBotProviderModel } from '@/database/models/agentBotProvider';
import type { LobeChatDatabase } from '@/database/type';
import { resolveToolMode } from '@/helpers/executionTarget';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { AiAgentService } from '@/server/services/aiAgent';

import { AgentBridgeService } from '../AgentBridgeService';
import { deletePairingRequest, peekPairingRequest, releasePairingClaim } from '../dmPairingStore';
import { submitBotFeedback } from '../feedbackSubmit';
import {
  claimOwnerBindingCode,
  completeOwnerBindingCode,
  releaseOwnerBindingCode,
} from '../ownerBindingStore';
import {
  type BotReplyLocale,
  type DmSettings,
  type GroupSettings,
  type GuestSettings,
  normalizeAllowFromEntries,
  type PlatformClient,
} from '../platforms';
import {
  renderApproveSuccess,
  renderCommandReply,
  renderFeedbackSubmitted,
  renderModeStatus,
  renderOwnerBindingReply,
  renderPairingApplicantApproved,
  renderWhoami,
} from '../replyTemplate';
import type { BotCommand } from './types';
import { dispatchTextCommand } from './utils';

const log = debug('lobe-server:bot:message-router');

/**
 * Build the list of bot commands. Each entry defines a name, description,
 * and handler. To add a new command, just append to this array.
 *
 * Handlers close over `info` so they can reach services and the bot's
 * own configuration (access policies, owner identity, applicationId) without
 * needing every command entry threaded through CommandContext.
 */
export function buildCommands(
  serverDB: LobeChatDatabase,
  info: {
    agentId: string;
    applicationId: string;
    /** PlatformClient used to message the applicant after a successful
     *  `/approve`; the owner runs the command in their own thread, but
     *  the applicant's notification has to land in the applicant's DM. */
    client: PlatformClient;
    dmSettings: DmSettings;
    /** Reads the shared Redis client lazily, when `/approve` runs. */
    getRedisClient: () => any;
    guestSettings: GuestSettings;
    groupSettings: GroupSettings;
    ownerBindingEnabled: boolean;
    /** Drop the router's cached bot so the next inbound rebuilds it. */
    invalidateBot: (platform: string, appId: string) => Promise<void>;
    operatorUserId?: string;
    platform: string;
    /** DB row id of the agent_bot_providers row for this bot — used by
     *  `/approve` to append a fresh applicant to `settings.allowFrom`. */
    providerId: string;
    userId: string;
    workspaceId?: string;
  },
): BotCommand[] {
  const {
    agentId,
    applicationId,
    client,
    dmSettings,
    guestSettings,
    groupSettings,
    ownerBindingEnabled,
    operatorUserId,
    platform,
    providerId,
    userId,
  } = info;

  const commands: BotCommand[] = [
    {
      description: 'Start a new conversation',
      handler: async (ctx) => {
        log('command /new: agent=%s, platform=%s', agentId, platform);
        // `replace: true` wipes the whole state (that's how topicId gets
        // reliably cleared — a merged `undefined` is dropped by the JSON
        // round-trip). Carry the `/mode` choice over: it's a conversation
        // preference, and starting a new topic shouldn't silently revert it.
        let toolMode: unknown;
        try {
          toolMode = (await ctx.getState())?.toolMode;
        } catch (error) {
          log('command /new: getState failed (mode not preserved): %O', error);
        }
        await ctx.setState(toolMode ? { toolMode, topicId: undefined } : { topicId: undefined }, {
          replace: true,
        });
        await ctx.post(renderCommandReply('cmdNewReset', ctx.replyLocale));
      },
      name: 'new',
    },
    {
      description: 'Show or switch the conversation mode (agent | chat)',
      // Declared so Discord/Slack surface a `/mode <mode>` argument in the
      // slash picker; the no-arg form shows the current mode.
      options: [
        {
          description: "Target mode: 'agent' or 'chat'; omit to show the current mode",
          name: 'mode',
          required: false,
        },
      ],
      handler: async (ctx) => {
        log('command /mode: agent=%s, platform=%s, args=%s', agentId, platform, ctx.args);
        const arg = ctx.args.trim().toLowerCase();
        if (!arg) {
          let override: 'agent' | 'chat' | undefined;
          try {
            const state = await ctx.getState();
            override =
              state?.toolMode === 'agent' || state?.toolMode === 'chat'
                ? state.toolMode
                : undefined;
          } catch (error) {
            log('command /mode: getState failed: %O', error);
          }
          // No explicit override → report the EFFECTIVE mode (the agent's
          // configured default) instead of an ambiguous "default" answer.
          // Best-effort: a config lookup failure falls back to `agent` (the
          // product default) rather than blocking the status reply.
          let current = override;
          if (!current) {
            try {
              const agent = await new AgentModel(
                serverDB,
                userId,
                info.workspaceId ?? undefined,
              ).getAgentConfigById(agentId);
              const chatConfig = (agent as any)?.chatConfig ?? undefined;
              current = resolveToolMode(chatConfig) === 'chat' ? 'chat' : 'agent';
            } catch (error) {
              log('command /mode: agent config lookup failed: %O', error);
              current = 'agent';
            }
          }
          await ctx.post(renderModeStatus(current, ctx.replyLocale));
          return;
        }
        if (arg !== 'agent' && arg !== 'chat') {
          await ctx.post(renderCommandReply('cmdModeUsage', ctx.replyLocale));
          return;
        }
        await ctx.setState({ toolMode: arg });
        await ctx.post(
          renderCommandReply(
            arg === 'agent' ? 'cmdModeSetAgent' : 'cmdModeSetChat',
            ctx.replyLocale,
          ),
        );
      },
      name: 'mode',
    },
    {
      description: 'Stop the current execution',
      handler: async (ctx) => {
        log('command /stop: agent=%s, platform=%s', agentId, platform);
        const isActive = AgentBridgeService.isThreadActive(ctx.threadId);
        if (!isActive) {
          await ctx.post(renderCommandReply('cmdStopNotActive', ctx.replyLocale));
          return;
        }
        const operationId = AgentBridgeService.getActiveOperationId(ctx.threadId);
        if (operationId) {
          try {
            const aiAgentService = new AiAgentService(serverDB, userId, {
              workspaceId: info.workspaceId ?? undefined,
            });
            const result = await aiAgentService.interruptTask({ operationId });
            if (!result.success) {
              log('command /stop: runtime interrupt rejected for operationId=%s', operationId);
              await ctx.post(renderCommandReply('cmdStopUnable', ctx.replyLocale));
              return;
            }
            AgentBridgeService.clearActiveThread(ctx.threadId);
            log('command /stop: interrupted operationId=%s', operationId);
          } catch (error) {
            log('command /stop: interruptTask failed: %O', error);
            await ctx.post(renderCommandReply('cmdStopUnable', ctx.replyLocale));
            return;
          }
        } else {
          AgentBridgeService.requestStop(ctx.threadId);
          log('command /stop: queued deferred stop for thread=%s', ctx.threadId);
        }
        await ctx.post(renderCommandReply('cmdStopRequested', ctx.replyLocale));
      },
      name: 'stop',
    },
    {
      description: 'Approve a pairing request: /approve <code>',
      options: [
        {
          description: 'The 8-character pairing code shown to the applicant',
          name: 'code',
          required: true,
        },
      ],
      handler: async (ctx) => {
        log(
          'command /approve: agent=%s, platform=%s, author=%s',
          agentId,
          platform,
          ctx.authorUserName ?? ctx.authorUserId,
        );

        if (
          dmSettings.policy !== 'pairing' &&
          guestSettings.policy !== 'pairing' &&
          groupSettings.policy !== 'pairing'
        ) {
          await ctx.post(renderCommandReply('cmdApproveDisabled', ctx.replyLocale));
          return;
        }

        // Owner check: the gate in passGatesOrNotify already lets the
        // operator through (operator bypass for pairing), but a
        // pre-approved third party would also pass that gate. The
        // command itself enforces owner-only at the action layer.
        if (!operatorUserId || !ctx.authorUserId || ctx.authorUserId !== operatorUserId) {
          await ctx.post(renderCommandReply('cmdApproveNotOwner', ctx.replyLocale));
          return;
        }

        const code = ctx.args.toUpperCase().trim();
        if (!code) {
          await ctx.post(renderCommandReply('cmdApproveUsage', ctx.replyLocale));
          return;
        }

        const redis = info.getRedisClient();
        const entry = await peekPairingRequest({
          applicationId,
          code,
          platform,
          redis,
        });
        if (!entry) {
          await ctx.post(renderCommandReply('cmdApproveUnknownCode', ctx.replyLocale));
          return;
        }

        const scope = entry.scope ?? 'dm';
        const approvedId =
          scope === 'group'
            ? (entry.targetChannelId ?? entry.applicantUserId)
            : entry.applicantUserId;
        const listKey = scope === 'group' ? 'groupAllowFrom' : 'allowFrom';
        const approvedLabel = entry.applicantUserName ?? approvedId;
        let persisted = false;
        try {
          const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
          const model = new AgentBotProviderModel(serverDB, userId, gateKeeper);
          const provider = await model.findById(providerId);
          if (provider) {
            const settings = (provider.settings ?? {}) as Record<string, unknown>;
            const entries = normalizeAllowFromEntries(settings[listKey]);
            if (!entries.some((candidate) => candidate.id === approvedId)) {
              entries.push(
                entry.applicantUserName
                  ? { id: approvedId, name: entry.applicantUserName }
                  : { id: approvedId },
              );
              await model.update(providerId, {
                settings: { ...settings, [listKey]: entries },
              });
              await info.invalidateBot(platform, applicationId);
            }
            persisted = true;
          } else {
            log(
              'command /approve: provider %s not found while approving code=%s',
              providerId,
              code,
            );
          }
        } catch (error) {
          log('command /approve: failed to persist %s for code=%s: %O', listKey, code, error);
        }
        if (!persisted) {
          // Leave the Redis entry intact: the owner can retry the same
          // /approve once the underlying issue clears, without forcing
          // the applicant to mint a new code. Release the peek claim
          // so the retry isn't blocked behind our own lock.
          await releasePairingClaim({ applicationId, code, platform, redis });
          await ctx.post(renderCommandReply('cmdApproveFailed', ctx.replyLocale));
          return;
        }

        await deletePairingRequest({
          applicationId,
          applicantUserId: entry.applicantUserId,
          scope,
          code,
          platform,
          redis,
        });

        // Notify the applicant on the surface where they requested access,
        // in their original locale. Telegram Guest Mode can update its
        // one-shot inline response through the Guest messenger.
        try {
          const messenger = client.getMessenger(entry.threadId);
          await messenger.createMessage(renderPairingApplicantApproved(scope, entry.replyLocale));
        } catch (error) {
          log('command /approve: failed to notify applicant for code=%s: %O', code, error);
        }

        await ctx.post(renderApproveSuccess(approvedLabel, ctx.replyLocale));
      },
      name: 'approve',
    },
    {
      description: 'Send feedback directly to the LobeHub team (no AI reply)',
      // Declaring the argument so Discord/Slack surface a `/feedback <message>`
      // prompt instead of registering the command as zero-arg (see the
      // `options` comment on the BotCommand interface).
      options: [
        {
          description: 'Your feedback message',
          name: 'message',
          required: true,
        },
      ],
      handler: async (ctx) => {
        log('command /feedback: agent=%s, platform=%s', agentId, platform);
        // Prefer the ephemeral channel when available (Slack / Discord
        // native slash) so the user's feedback content and the bot's
        // confirmation never leak into the public channel. Text-based
        // platforms (Telegram, Feishu) have no ephemeral primitive, so
        // we fall back to a regular post — those platforms are DM-first
        // anyway, so the privacy concern is much smaller.
        const reply = ctx.postEphemeral ?? ctx.post;
        const body = ctx.args.trim();
        if (!body) {
          await reply(renderCommandReply('cmdFeedbackUsage', ctx.replyLocale));
          return;
        }
        const result = await submitBotFeedback(serverDB, {
          applicationId,
          body,
          platform,
          threadId: ctx.threadId,
          userId,
        });
        if (!result.success) {
          await reply(renderCommandReply('cmdFeedbackError', ctx.replyLocale));
          return;
        }
        await reply(renderFeedbackSubmitted(result.issueUrl, ctx.replyLocale));
      },
      name: 'feedback',
    },
    {
      // Ungated on purpose: the whole point is to let the operator learn
      // the value for `settings.userId` before it is configured, and the
      // reply contains nothing but the caller's own identity.
      bypassGate: true,
      description: 'Show your platform user ID for the bot settings',
      handler: async (ctx) => {
        log(
          'command /whoami: agent=%s, platform=%s, author=%s',
          agentId,
          platform,
          ctx.authorUserName ?? ctx.authorUserId,
        );
        const reply = ctx.postEphemeral ?? ctx.post;
        const callerId = ctx.authorUserId?.trim();
        if (!callerId) {
          await reply(renderCommandReply('cmdWhoamiUnavailable', ctx.replyLocale));
          return;
        }
        await reply(
          renderWhoami(
            {
              isOperator: !!operatorUserId && callerId === operatorUserId,
              ownerBindingEnabled,
              userId: callerId,
              userName: ctx.authorUserName,
            },
            ctx.replyLocale,
          ),
        );
      },
      name: 'whoami',
    },
  ];

  if (ownerBindingEnabled) {
    commands.push({
      bypassGate: true,
      description: 'Bind the current private account as the bot owner: /bind <code>',
      options: [
        {
          description: 'The 15-minute owner binding code from bot settings',
          name: 'code',
          required: true,
        },
      ],
      handler: async (ctx) => {
        if (ctx.isDM !== true) {
          await ctx.post(renderOwnerBindingReply('dm-only', ctx.replyLocale));
          return;
        }

        const code = ctx.args.trim();
        if (!code) {
          await ctx.post(renderOwnerBindingReply('usage', ctx.replyLocale));
          return;
        }

        const callerId = ctx.authorUserId?.trim();
        if (!callerId) {
          await ctx.post(renderOwnerBindingReply('sender-unavailable', ctx.replyLocale));
          return;
        }

        const claim = await claimOwnerBindingCode({ applicationId, code, platform });
        if (claim === 'redis-unavailable') {
          await ctx.post(renderOwnerBindingReply('unavailable', ctx.replyLocale));
          return;
        }
        if (claim === 'invalid') {
          await ctx.post(renderOwnerBindingReply('code-invalid', ctx.replyLocale));
          return;
        }

        let persisted = false;
        try {
          const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
          const model = new AgentBotProviderModel(serverDB, userId, gateKeeper, info.workspaceId);
          const provider = await model.findById(providerId);
          if (provider?.platform === platform && provider.applicationId === applicationId) {
            const settings = (provider.settings ?? {}) as Record<string, unknown>;
            // `settings.ownerBoundAt` is the only proof that a /bind actually
            // happened. The row's `updatedAt` moves on ANY settings save and
            // must never be used as the completion signal (LOBE-166). Write
            // both in this one update, and overwrite both on every rebind —
            // including a rebind to the same person — so the client can compare
            // against the snapshot it captured before issuing the code.
            await model.update(providerId, {
              settings: { ...settings, ownerBoundAt: new Date().toISOString(), userId: callerId },
            });
            persisted = true;
            await info.invalidateBot(platform, applicationId);
          }
        } catch (error) {
          log(
            'command /bind: failed to persist owner identity for platform=%s: %O',
            platform,
            error,
          );
        }

        if (!persisted) {
          await releaseOwnerBindingCode({ applicationId, code, platform });
          await ctx.post(renderOwnerBindingReply('save-failed', ctx.replyLocale));
          return;
        }

        const completion = await completeOwnerBindingCode({ applicationId, code, platform });
        await ctx.post(
          renderOwnerBindingReply(
            completion === 'redis-unavailable' ? 'cleanup-failed' : 'success',
            ctx.replyLocale,
          ),
        );
      },
      name: 'bind',
    });
  }

  return commands;
}

/**
 * Register all commands on the bot via both native slash-command events
 * (Slack, Discord) and text-based onNewMessage handlers (Telegram, Feishu, etc.).
 *
 * To add a new command, add an entry to `buildCommands()` — it will be
 * automatically registered on all platforms.
 */
export function registerCommands(
  bot: Chat<any>,
  commands: BotCommand[],
  client: PlatformClient,
  locale: {
    detectFromMessage: (message: { author?: unknown }) => BotReplyLocale;
    fallback: BotReplyLocale;
  },
  /**
   * Apply the same access stack the message handlers use (allowFrom +
   * group policy + DM policy) before dispatching a command. Returns true
   * when the dispatch is allowed; on rejection the helper has already
   * posted the appropriate notice in the thread.
   */
  gate: (
    thread: { id: string; isDM?: boolean; post: (t: string) => Promise<unknown> },
    author: { userId?: string; userName?: string },
    replyLocale: BotReplyLocale,
    caller: string,
    message?: unknown,
  ) => Promise<boolean>,
): void {
  // --- Native slash commands (Slack, Discord) ---
  for (const cmd of commands) {
    bot.onSlashCommand(`/${cmd.name}`, async (event) => {
      // Native slash-command events expose a Channel (Postable, so it has
      // `id` / `isDM` / `post`) and the invoking user. Project both into
      // the gate-friendly thread/author shape.
      const threadLike = {
        id: event.channel.id,
        isDM: event.channel.isDM,
        post: (t: string) => event.channel.post(t),
      };
      const authorLike = {
        userId: event.user?.userId,
        userName: event.user?.userName,
      };
      const replyLocale = locale.fallback;
      if (
        !cmd.bypassGate &&
        !(await gate(threadLike, authorLike, replyLocale, `onSlashCommand /${cmd.name}`, event))
      ) {
        return;
      }
      await cmd.handler({
        args: event.text,
        authorUserId: authorLike.userId,
        authorUserName: authorLike.userName,
        getState: () => event.channel.state,
        post: (text) => event.channel.post(text),
        // Wire chat-sdk's `postEphemeral` so commands that want a private
        // reply (e.g. `/feedback`) can opt in. `fallbackToDM: true` so
        // Discord — which has no channel-level ephemeral outside of an
        // interaction response — still delivers privately by DMing the
        // user instead of broadcasting to the channel. Wrapped here, not
        // in the handler, so commands stay platform-agnostic.
        postEphemeral: event.user
          ? (text: string) => event.channel.postEphemeral(event.user!, text, { fallbackToDM: true })
          : undefined,
        // Native slash-command events don't carry a Chat SDK Message, so
        // there's no per-sender locale field to read; use the channel
        // default. Telegram/Feishu/etc. dispatch via the text-based path
        // below, which DOES have per-message locale.
        replyLocale,
        setState: (state, opts) => event.channel.setState(state, opts),
        isDM: event.channel.isDM,
        threadId: event.channel.id,
      });
    });
  }

  // --- Text-based slash commands (Telegram, Feishu, etc.) ---
  // Platforms that don't support native onSlashCommand send /commands as
  // regular text messages. This handler intercepts them in unsubscribed
  // threads (e.g. first command in a group chat or DM).
  // The regex also matches mention-prefixed messages (e.g. "<@U123> /new")
  // so that platforms like Slack can dispatch commands from @-mentions.
  const namePattern = commands.map((c) => c.name).join('|');
  const regex = new RegExp(`(?:^|\\s)\\/(?:${namePattern})(?:\\s|$|@)`);
  bot.onNewMessage(regex, async (thread, message) => {
    if (message.author.isBot === true) return;
    const sanitized = client.sanitizeUserInput?.(message.text ?? '', message) ?? message.text;
    const result = dispatchTextCommand(sanitized, commands);
    if (!result) return;
    const replyLocale = locale.detectFromMessage(message);
    if (
      !result.command.bypassGate &&
      !(await gate(
        thread,
        message.author,
        replyLocale,
        `onNewMessage /${result.command.name}`,
        message,
      ))
    ) {
      return;
    }
    await result.command.handler({
      args: result.args,
      authorUserId: message.author?.userId,
      authorUserName: message.author?.userName,
      getState: () => thread.state,
      post: (text) => thread.post(text),
      replyLocale,
      setState: (state, opts) => thread.setState(state, opts),
      isDM: thread.isDM === true,
      threadId: thread.id,
    });
  });
}
