import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Message, PipelineContext } from '../../types';
import { TimeReminderInjector } from '../TimeReminderInjector';

// The injector builds its logger once at module load, so mock `debug` to hand
// out one stable spy that every test can inspect.
const { logFn } = vi.hoisted(() => ({ logFn: vi.fn() }));
vi.mock('debug', () => ({ default: () => logFn }));

const makeContext = (messages: Message[]): PipelineContext => ({
  initialState: { messages: [], model: 'test-model', provider: 'test-provider' },
  isAborted: false,
  messages,
  metadata: { maxTokens: 4000, model: 'test-model' },
});

const userMessage = (createdAt: number): Message => ({
  content: 'hello',
  createdAt,
  role: 'user',
});

describe('TimeReminderInjector fallback logging', () => {
  beforeEach(() => {
    logFn.mockClear();
  });

  it('logs when the timezone is unset and the block falls back to UTC', async () => {
    await new TimeReminderInjector({ enabled: true }).process(makeContext([userMessage(0)]));

    expect(logFn).toHaveBeenCalledWith('timezone unset — falling back to UTC');
  });

  it('logs when the timezone is invalid and reminders are skipped', async () => {
    await new TimeReminderInjector({ enabled: true, timezone: 'Not/AZone' }).process(
      makeContext([userMessage(0)]),
    );

    expect(logFn).toHaveBeenCalledWith('timezone %s is invalid — reminders skipped', 'Not/AZone');
  });

  it('stays quiet when a valid timezone is configured', async () => {
    await new TimeReminderInjector({ enabled: true, timezone: 'Asia/Shanghai' }).process(
      makeContext([userMessage(0)]),
    );

    expect(logFn).not.toHaveBeenCalled();
  });
});
