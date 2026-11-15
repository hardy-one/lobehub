import type { StateAdapter } from 'chat';
import { Chat } from 'chat';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createQQAdapter } from './adapter';
import { QQ_EVENT_TYPES, QQ_OP_CODES } from './types';

/** Minimal in-memory `StateAdapter`; production wires ioredis. */
const createMemoryState = (): StateAdapter => {
  const values = new Map<string, unknown>();
  const lists = new Map<string, unknown[]>();
  const queues = new Map<string, unknown[]>();
  const subscribed = new Set<string>();

  return {
    acquireLock: async (threadId) => ({ expiresAt: Number.MAX_SAFE_INTEGER, threadId, token: 't' }),
    appendToList: async (key, value) => {
      lists.set(key, [...(lists.get(key) ?? []), value]);
    },
    connect: async () => {},
    delete: async (key) => {
      values.delete(key);
    },
    dequeue: async (threadId) => (queues.get(threadId)?.shift() as any) ?? null,
    disconnect: async () => {},
    enqueue: async (threadId, entry) => {
      const queue = [...(queues.get(threadId) ?? []), entry];
      queues.set(threadId, queue);
      return queue.length;
    },
    extendLock: async () => true,
    forceReleaseLock: async () => {},
    get: async <T>(key: string) => (values.get(key) ?? null) as T | null,
    getList: async <T>(key: string) => (lists.get(key) ?? []) as T[],
    isSubscribed: async (threadId) => subscribed.has(threadId),
    queueDepth: async (threadId) => queues.get(threadId)?.length ?? 0,
    releaseLock: async () => {},
    set: async (key, value) => {
      values.set(key, value);
    },
    setIfNotExists: async (key, value) => {
      if (values.has(key)) return false;
      values.set(key, value);
      return true;
    },
    subscribe: async (threadId) => {
      subscribed.add(threadId);
    },
    unsubscribe: async (threadId) => {
      subscribed.delete(threadId);
    },
  };
};

/** QQ's auth + bot-info endpoints; everything else is never reached in these tests. */
const stubQQHttp = () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: any) => {
      const url = String(input);
      const json = { 'content-type': 'application/json' };
      if (url.includes('getAppAccessToken')) {
        return new Response(JSON.stringify({ access_token: 'token', expires_in: 7200 }), {
          headers: json,
          status: 200,
        });
      }
      if (url.endsWith('/users/@me')) {
        return new Response(JSON.stringify({ id: 'BOT_USER_ID', username: 'qq-bot' }), {
          headers: json,
          status: 200,
        });
      }
      return new Response('{}', { headers: json, status: 200 });
    }),
  );
};

const makeRequest = (body: unknown) =>
  new Request('http://localhost/webhook', {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });

const dispatch = (t: string, d: Record<string, any>) => ({
  d: {
    author: { id: 'user_1' },
    content: '帮我看看这个',
    group_openid: 'group_1',
    id: 'msg_1',
    timestamp: '2026-11-12T10:00:00Z',
    ...d,
  },
  id: 'event_1',
  op: QQ_OP_CODES.DISPATCH,
  t,
});

const waitFor = async (predicate: () => boolean, timeoutMs = 2000) => {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('timed out waiting for handler');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const createChat = async () => {
  stubQQHttp();

  const adapter = createQQAdapter({ appId: 'app', clientSecret: 'secret' });
  const chat = new Chat({
    adapters: { qq: adapter },
    state: createMemoryState(),
    userName: 'qq-bot',
  });
  await chat.initialize();

  return { adapter, chat };
};

describe('QQ full group messages (GROUP_MESSAGE_CREATE)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('routes an unaddressed group message as chatter instead of a mention', async () => {
    const { adapter, chat } = await createChat();

    const chatter: string[] = [];
    let mentions = 0;
    chat.onNewMessage(/.*/, async (_thread, message) => {
      chatter.push(message.text);
    });
    chat.onNewMention(async () => {
      mentions += 1;
    });

    await adapter.handleWebhook(
      makeRequest(dispatch(QQ_EVENT_TYPES.GROUP_MESSAGE_CREATE, { mentions: [] })),
    );
    await waitFor(() => chatter.length === 1);

    expect(chatter[0]).toBe('帮我看看这个');
    expect(mentions).toBe(0);
  });

  it('keeps a full group message that mentions the bot on the mention path', async () => {
    const { adapter, chat } = await createChat();

    const mentioned: string[] = [];
    let chatter = 0;
    chat.onNewMessage(/.*/, async () => {
      chatter += 1;
    });
    chat.onNewMention(async (_thread, message) => {
      mentioned.push(message.text);
    });

    // QQ rewrites an @-mention to `<@member_openid>`, which the bot id cannot be matched against,
    // so the payload's `mentions` list is what identifies the bot here.
    await adapter.handleWebhook(
      makeRequest(
        dispatch(QQ_EVENT_TYPES.GROUP_MESSAGE_CREATE, {
          content: '<@B2C3D4E5F6> 帮我看下',
          mentions: [{ id: 'BOT_USER_ID' }],
        }),
      ),
    );
    await waitFor(() => mentioned.length === 1);

    expect(mentioned[0]).toBe('帮我看下');
    expect(chatter).toBe(0);
  });
});
