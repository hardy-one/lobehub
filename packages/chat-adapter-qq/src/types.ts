import type { QQPassiveStore } from './passive';

export interface QQAdapterConfig {
  appId: string;
  clientSecret: string;
  /**
   * Tracks each conversation's passive-reply window (see `passive.ts`). Defaults to an in-process
   * store, which only works for a single instance — a multi-instance deployment passes a shared one.
   */
  passiveStore?: QQPassiveStore;
}

export interface QQThreadId {
  /** For guild channels, the guild_id is needed for some operations */
  guildId?: string;
  id: string;
  type: 'group' | 'guild' | 'c2c' | 'dms';
}

export interface QQAuthor {
  id?: string;
  /** Set on a `mentions` entry when that mention is the bot itself, on payloads that report it. */
  is_you?: boolean;
  member_openid?: string;
  member_role?: 'admin' | 'member' | 'owner';
  /** Scope a `mentions` entry applies to, as reported by some payloads. */
  scope?: string;
  union_openid?: string;
  user_openid?: string;
  /**
   * The sender's nickname. QQ sets it on group events and may leave it blank elsewhere; inside a
   * group it can also be the member's group card. Treat it as a display name only - the openid
   * stays the identity used for matching and replies.
   */
  username?: string;
}

export interface QQAttachment {
  content_type: string;
  filename: string;
  height?: number;
  size: number;
  url: string;
  width?: number;
}

export interface QQMessageReference {
  message_id: string;
}

export interface QQRawMessage {
  attachments?: QQAttachment[];
  author: QQAuthor & { id: string };
  channel_id?: string;
  content: string;
  group_openid?: string;
  guild_id?: string;
  id: string;
  member?: {
    joined_at: string;
    roles?: string[];
  };
  mentions?: QQAuthor[];
  message_reference?: QQMessageReference;
  seq?: number;
  seq_in_channel?: string;
  timestamp: string;
}

export interface QQWebhookPayload {
  d: QQWebhookEventData;
  id: string;
  op: number;
  s?: number;
  t?: string;
}

export interface QQWebhookEventData {
  attachments?: QQAttachment[];
  author?: QQAuthor;
  channel_id?: string;
  content?: string;
  event_ts?: string;
  group_openid?: string;
  guild_id?: string;
  id?: string;
  member?: {
    joined_at: string;
    roles?: string[];
  };
  /** Users @-mentioned by the message. Present on group message events. */
  mentions?: QQAuthor[];
  plain_token?: string;
  timestamp?: string;
}

export interface QQWebhookVerifyData {
  event_ts: string;
  plain_token: string;
}

export interface QQAccessTokenResponse {
  access_token: string;
  expires_in: number;
}

export interface QQSendMessageParams {
  [key: string]: unknown;
  content?: string;
  event_id?: string;
  markdown?: {
    content: string;
  };
  /**
   * Rich-media payload used together with `msg_type: 7 (MEDIA)`. The
   * `file_info` token comes from the upload step (see
   * `QQApiClient.uploadGroupRichMedia` / `uploadC2CRichMedia`).
   */
  media?: {
    file_info: string;
  };
  msg_id?: string;
  msg_seq?: number;
  msg_type: number;
}

export interface QQSendMessageResponse {
  id: string;
  timestamp: string;
}

export type QQMessageType = 'group' | 'guild' | 'c2c' | 'dms';

export const QQ_MSG_TYPE = {
  ARK: 3,
  EMBED: 4,
  MARKDOWN: 2,
  MEDIA: 7,
  TEXT: 0,
} as const;

export const QQ_EVENT_TYPES = {
  AT_MESSAGE_CREATE: 'AT_MESSAGE_CREATE',
  C2C_MESSAGE_CREATE: 'C2C_MESSAGE_CREATE',
  DIRECT_MESSAGE_CREATE: 'DIRECT_MESSAGE_CREATE',
  GROUP_AT_MESSAGE_CREATE: 'GROUP_AT_MESSAGE_CREATE',
  /**
   * Every group message, not just the ones that @ the bot. Only delivered once the owner turns on
   * 「接收所有消息」 for the bot; same `GROUP_AND_C2C_EVENT` intent as `GROUP_AT_MESSAGE_CREATE` and
   * the same payload shape.
   */
  GROUP_MESSAGE_CREATE: 'GROUP_MESSAGE_CREATE',
} as const;

export const QQ_OP_CODES = {
  DISPATCH: 0,
  HTTP_CALLBACK_ACK: 12,
  VERIFY: 13,
} as const;

// ---- WebSocket Gateway OP Codes ----

export const QQ_WS_OP_CODES = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  RESUME: 6,
  RECONNECT: 7,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
} as const;

// ---- WebSocket Gateway Intents ----

export const QQ_INTENTS = {
  AUDIO_ACTION: 1 << 29,
  DIRECT_MESSAGE: 1 << 12,
  FORUMS_EVENT: 1 << 28,
  GROUP_AND_C2C_EVENT: 1 << 25,
  GUILD_MEMBERS: 1 << 1,
  GUILD_MESSAGE_REACTIONS: 1 << 10,
  GUILD_MESSAGES: 1 << 9,
  GUILDS: 1 << 0,
  INTERACTION: 1 << 26,
  MESSAGE_AUDIT: 1 << 27,
  PUBLIC_GUILD_MESSAGES: 1 << 30,
} as const;

// ---- WebSocket Gateway Types ----

export interface QQGatewayPayload {
  d: any;
  id?: string;
  op: number;
  s?: number;
  t?: string;
}

export interface QQGatewayHelloData {
  heartbeat_interval: number;
}

export interface QQGatewayReadyData {
  session_id: string;
  shard: [number, number];
  user: { bot: boolean; id: string; username: string };
  version: number;
}

export interface QQGatewayUrlResponse {
  session_start_limit?: {
    max_concurrency: number;
    remaining: number;
    reset_after: number;
    total: number;
  };
  shards?: number;
  url: string;
}
