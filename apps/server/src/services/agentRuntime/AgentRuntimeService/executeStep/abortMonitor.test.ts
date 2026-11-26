/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { STEP_ABORT_MONITOR_INTERVAL_MS } from '../constants';
import { sharedAbortMonitor } from './abortMonitor';
import type { StepAbortMonitorCoordinator } from './abortPoll';
import { startStepAbortPoll } from './abortPoll';

const createCoordinator = (overrides: Partial<StepAbortMonitorCoordinator> = {}) =>
  ({
    getInterruptSentinels: vi.fn(async () => new Set<string>()),
    loadAgentStatus: vi.fn(async () => null),
    ...overrides,
  }) as StepAbortMonitorCoordinator;

const advanceTicks = async (count: number) => {
  for (let index = 0; index < count; index += 1) {
    await vi.advanceTimersByTimeAsync(STEP_ABORT_MONITOR_INTERVAL_MS);
  }
};

describe('shared step abort monitor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    sharedAbortMonitor.resetForTest();
  });

  afterEach(() => {
    sharedAbortMonitor.resetForTest();
    vi.useRealTimers();
  });

  it('uses one timer and one MGET for N active steps, with no per-step EXISTS', async () => {
    const coordinator = createCoordinator();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const pollers = Array.from({ length: 5 }, (_, index) =>
      startStepAbortPoll({ coordinator: coordinator as any }, `op-${index}`, index),
    );

    expect(sharedAbortMonitor.timerActive).toBe(true);
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy.mock.calls[0][1]).toBe(STEP_ABORT_MONITOR_INTERVAL_MS);

    await advanceTicks(3);

    expect(coordinator.getInterruptSentinels).toHaveBeenCalledTimes(3);
    expect(coordinator.getInterruptSentinels).toHaveBeenCalledWith([
      'op-0',
      'op-1',
      'op-2',
      'op-3',
      'op-4',
    ]);
    expect(setTimeoutSpy).toHaveBeenCalledTimes(4);
    for (const poller of pollers) expect(poller.signal.aborted).toBe(false);

    for (const poller of pollers) poller.stop();
    setTimeoutSpy.mockRestore();
  });

  it('aborts only sentinel-hit operations on the next tick', async () => {
    const coordinator = createCoordinator({
      getInterruptSentinels: vi.fn(
        async (operationIds: string[]) => new Set(operationIds.filter((id) => id === 'op-2')),
      ),
    });
    const pollers = ['op-1', 'op-2', 'op-3'].map((id, index) =>
      startStepAbortPoll({ coordinator: coordinator as any }, id, index),
    );

    await advanceTicks(1);

    expect(pollers[1].signal.aborted).toBe(true);
    expect(pollers[0].signal.aborted).toBe(false);
    expect(pollers[2].signal.aborted).toBe(false);
    expect(sharedAbortMonitor.activeControllerCount).toBe(2);

    for (const poller of pollers) poller.stop();
  });

  it('stops the shared timer when the last controller unregisters', async () => {
    const coordinator = createCoordinator();
    const first = startStepAbortPoll({ coordinator: coordinator as any }, 'op-a', 0);
    const second = startStepAbortPoll({ coordinator: coordinator as any }, 'op-b', 0);

    first.stop();
    expect(sharedAbortMonitor.timerActive).toBe(true);
    expect(sharedAbortMonitor.activeControllerCount).toBe(1);

    second.stop();
    expect(sharedAbortMonitor.timerActive).toBe(false);
    expect(sharedAbortMonitor.activeControllerCount).toBe(0);
    await advanceTicks(4);
    expect(coordinator.getInterruptSentinels).not.toHaveBeenCalled();
  });

  it('aborts via the 30s status fallback when only the status says interrupted', async () => {
    const coordinator = createCoordinator({
      loadAgentStatus: vi.fn(async () => 'interrupted' as const),
    });
    const poller = startStepAbortPoll({ coordinator: coordinator as any }, 'op-status', 0);

    await advanceTicks(1);
    expect(coordinator.loadAgentStatus).not.toHaveBeenCalled();
    await advanceTicks(59);
    expect(coordinator.loadAgentStatus).toHaveBeenCalledWith('op-status');
    await Promise.resolve();
    expect(poller.signal.aborted).toBe(true);
    poller.stop();
  });

  it('backs off after a failed MGET and continues ticking', async () => {
    const getInterruptSentinels = vi
      .fn()
      .mockRejectedValueOnce(new Error('redis timeout'))
      .mockResolvedValue(new Set<string>());
    const coordinator = createCoordinator({ getInterruptSentinels });
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const poller = startStepAbortPoll({ coordinator: coordinator as any }, 'op-backoff', 0);

    await advanceTicks(1);
    expect(getInterruptSentinels).toHaveBeenCalledTimes(1);
    expect(poller.signal.aborted).toBe(false);
    expect(sharedAbortMonitor.timerActive).toBe(true);
    expect(setTimeoutSpy.mock.calls[1][1]).toBe(STEP_ABORT_MONITOR_INTERVAL_MS * 2);

    await vi.advanceTimersByTimeAsync(STEP_ABORT_MONITOR_INTERVAL_MS * 2);
    expect(getInterruptSentinels).toHaveBeenCalledTimes(2);
    poller.stop();
    setTimeoutSpy.mockRestore();
  });

  it('checks status at most once per operation per fallback window', async () => {
    const loadAgentStatus = vi.fn(async () => null);
    const coordinator = createCoordinator({ loadAgentStatus });
    const first = startStepAbortPoll({ coordinator: coordinator as any }, 'op-shared', 0);
    const second = startStepAbortPoll({ coordinator: coordinator as any }, 'op-shared', 1);

    await advanceTicks(60);
    expect(loadAgentStatus).toHaveBeenCalledTimes(1);
    expect(coordinator.getInterruptSentinels).toHaveBeenCalledTimes(60);

    first.stop();
    second.stop();
  });
});
