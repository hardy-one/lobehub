import { Chat } from 'chat';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QQAdapter } from './adapter';
import { QQGatewayConnection } from './gateway';
import { QQ_WS_OP_CODES } from './types';

// ---- Mock WebSocket ------------------------------------------------------
// Mirrors gateway.test.ts's socket: close() emits 'close' synchronously, so the
// gateway's own close handler runs inside QQGatewayConnection.close().

class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.OPEN;
  url: string;
  sentMessages: string[] = [];
  closeCode?: number;
  closeReason?: string;
  closeCalls = 0;
  private listeners: Map<string, Array<(...args: any[]) => void>> = new Map();

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    setTimeout(() => this.emit('open', {}), 0);
  }

  addEventListener(event: string, fn: (...args: any[]) => void) {
    const list = this.listeners.get(event) || [];
    list.push(fn);
    this.listeners.set(event, list);
  }

  removeEventListener(event: string, fn: (...args: any[]) => void) {
    const list = this.listeners.get(event) || [];
    this.listeners.set(
      event,
      list.filter((f) => f !== fn),
    );
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close(code?: number, reason?: string) {
    this.closeCalls++;
    this.closeCode = code ?? 1000;
    this.closeReason = reason ?? '';
    this.readyState = MockWebSocket.CLOSED;
    this.emit('close', { code: this.closeCode, reason: this.closeReason });
  }

  emit(event: string, data: any) {
    for (const fn of this.listeners.get(event) || []) fn(data);
  }

  simulateMessage(payload: Record<string, any>) {
    this.emit('message', { data: JSON.stringify(payload) });
  }

  heartbeats() {
    return this.sentMessages.filter((m) => JSON.parse(m).op === QQ_WS_OP_CODES.HEARTBEAT).length;
  }
}

const createReadyPayload = () => ({
  d: { session_id: 'sess_1', shard: [0, 1], user: { bot: true, id: 'bot_1' }, version: 1 },
  op: QQ_WS_OP_CODES.DISPATCH,
  s: 1,
  t: 'READY',
});

const HEARTBEAT_INTERVAL_MS = 45_000;
const WEBHOOK_URL = 'http://localhost:3000/api/agent/webhooks/qq/test_app';

describe('QQAdapter.disconnect', () => {
  let adapter: QQAdapter;
  let closeSpy: ReturnType<typeof vi.spyOn>;

  const mockChat = {
    getLogger: vi.fn(() => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() })),
    getUserName: vi.fn(() => 'TestBot'),
    processMessage: vi.fn(),
  };

  beforeEach(async () => {
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok', { status: 200 })));
    vi.useFakeTimers();
    // Zero jitter: the heartbeat interval is scheduled immediately after HELLO.
    vi.spyOn(Math, 'random').mockReturnValue(0);

    adapter = new QQAdapter({ appId: 'test_app', clientSecret: 'test_secret' });
    vi.spyOn((adapter as any).api, 'getAccessToken').mockResolvedValue('mock_token');
    vi.spyOn((adapter as any).api, 'getBotInfo').mockResolvedValue(null);
    vi.spyOn((adapter as any).api, 'getGatewayUrl').mockResolvedValue({
      url: 'wss://mock-gateway.qq.com/websocket/',
    });
    await adapter.initialize(mockChat as any);

    closeSpy = vi.spyOn(QQGatewayConnection.prototype, 'close');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /** Drive startGatewayListener through HELLO → IDENTIFY → READY. */
  async function startGateway(): Promise<MockWebSocket> {
    const abort = new AbortController();
    const listener = adapter.startGatewayListener(
      { waitUntil: vi.fn() },
      600_000,
      abort.signal,
      WEBHOOK_URL,
    );

    await vi.advanceTimersByTimeAsync(10);
    const ws = MockWebSocket.instances[0];
    expect(ws).toBeDefined();

    ws.simulateMessage({
      d: { heartbeat_interval: HEARTBEAT_INTERVAL_MS },
      op: QQ_WS_OP_CODES.HELLO,
    });
    await vi.advanceTimersByTimeAsync(10);
    ws.simulateMessage(createReadyPayload());
    await listener;

    return ws;
  }

  it('closes the gateway socket, stops the heartbeat and prevents reconnect', async () => {
    const ws = await startGateway();
    const timersBefore = vi.getTimerCount();
    expect(timersBefore).toBeGreaterThan(0); // heartbeat interval + duration timer
    expect(ws.heartbeats()).toBeGreaterThanOrEqual(1);

    await adapter.disconnect();

    // close() was actually invoked on the live QQGatewayConnection instance.
    expect(closeSpy).toHaveBeenCalledTimes(1);
    // The socket is closed with the SDK's normal close frame.
    expect(ws.closeCalls).toBe(1);
    expect(ws.closeCode).toBe(1000);
    expect(ws.closeReason).toBe('Client shutdown');
    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
    // stopHeartbeat() cleared the interval; only the inert duration timer is left.
    expect(vi.getTimerCount()).toBeLessThan(timersBefore);

    const heartbeatsAtDisconnect = ws.heartbeats();
    await vi.advanceTimersByTimeAsync(10 * HEARTBEAT_INTERVAL_MS);

    // No further heartbeats and no reconnect socket: closed=true suppresses both.
    expect(ws.heartbeats()).toBe(heartbeatsAtDisconnect);
    expect(MockWebSocket.instances).toHaveLength(1);
    // The reference is dropped, so reconnect logic can no longer take it over.
    expect((adapter as any).gateway).toBeNull();
  });

  it('is a safe no-op when no gateway was started (webhook mode)', async () => {
    await expect(adapter.disconnect()).resolves.toBeUndefined();

    expect(closeSpy).not.toHaveBeenCalled();
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it('is idempotent across repeated calls', async () => {
    const ws = await startGateway();

    await expect(adapter.disconnect()).resolves.toBeUndefined();
    await expect(adapter.disconnect()).resolves.toBeUndefined();
    await expect(adapter.disconnect()).resolves.toBeUndefined();

    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(ws.closeCalls).toBe(1);
    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
    expect((adapter as any).gateway).toBeNull();
  });

  it('Chat#shutdown() reaches QQAdapter.disconnect() and closes the real socket', async () => {
    // Regression for the missed link: the SDK skips adapters without
    // `disconnect`, so prove the REAL Chat#shutdown() -> QQAdapter.disconnect()
    // -> QQGatewayConnection.close() -> ws.close(1000) chain end to end.
    const ws = await startGateway();
    const stateDisconnect = vi.fn().mockResolvedValue(undefined);

    const chat = new Chat({
      adapters: { qq: adapter },
      logger: { debug() {}, error() {}, info() {}, warn() {} },
      state: { disconnect: stateDisconnect },
      userName: 'test-qq-bot',
    } as any);

    await chat.shutdown();

    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(ws.closeCode).toBe(1000);
    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
    expect(stateDisconnect).toHaveBeenCalledTimes(1);
    expect((adapter as any).gateway).toBeNull();
  });
});
