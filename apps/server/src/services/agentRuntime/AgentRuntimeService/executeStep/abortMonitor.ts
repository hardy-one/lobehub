import debug from 'debug';

import {
  LEGACY_INTERRUPT_STATE_POLL_INTERVAL_MS,
  STEP_ABORT_MONITOR_INTERVAL_MS,
  STEP_ABORT_POLL_MAX_BACKOFF,
} from '../constants';
import type { StepAbortMonitorCoordinator } from './abortPoll';

const log = debug('lobe-server:agent-runtime:abort-monitor');

interface MonitoredOperation {
  controllers: Set<AbortController>;
  lastStatusCheckAt: number;
  statusCheckInFlight: boolean;
}

/**
 * Process-wide interrupt monitor. All live steps in this process share one
 * timer: a tick reads every operation's sentinel in one MGET instead of
 * giving each step its own timer and EXISTS poll.
 */
class SharedAbortMonitor {
  private readonly operations = new Map<string, MonitoredOperation>();

  private timer: ReturnType<typeof setTimeout> | undefined;

  private tickInFlight: Promise<void> | undefined;

  private failures = 0;

  private coordinator: StepAbortMonitorCoordinator | undefined;

  register(
    coordinator: StepAbortMonitorCoordinator,
    operationId: string,
    controller: AbortController,
  ): void {
    this.coordinator = coordinator;
    const operation = this.operations.get(operationId) ?? {
      controllers: new Set<AbortController>(),
      lastStatusCheckAt: Date.now(),
      statusCheckInFlight: false,
    };
    operation.controllers.add(controller);
    this.operations.set(operationId, operation);
    if (!this.timer) this.schedule();
  }

  unregister(operationId: string, controller: AbortController): void {
    const operation = this.operations.get(operationId);
    if (!operation) return;
    operation.controllers.delete(controller);
    if (operation.controllers.size > 0) return;
    this.operations.delete(operationId);
    // A new step may register while an in-flight tick is awaiting Redis. The
    // tick reschedules only when it still sees active operations, so no timer
    // survives the last unregister and no running step is left unticked.
    if (this.operations.size === 0 && this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  resetForTest(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.tickInFlight = undefined;
    this.failures = 0;
    this.coordinator = undefined;
    this.operations.clear();
  }

  /** Test hook: how many operation controllers are currently registered. */
  get activeControllerCount(): number {
    let count = 0;
    for (const operation of this.operations.values()) count += operation.controllers.size;
    return count;
  }

  /** Test hook: whether the shared timer is currently armed. */
  get timerActive(): boolean {
    return this.timer !== undefined;
  }

  /** Test hook: drive a tick without waiting for the wall clock. */
  tickForTest(): Promise<void> {
    return this.tick();
  }

  private schedule(): void {
    if (this.timer || this.operations.size === 0) return;
    const multiplier = Math.min(2 ** this.failures, STEP_ABORT_POLL_MAX_BACKOFF);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.tick();
    }, STEP_ABORT_MONITOR_INTERVAL_MS * multiplier);
  }

  private async tick(): Promise<void> {
    if (this.tickInFlight) return this.tickInFlight;
    if (this.operations.size === 0) return;

    const coordinator = this.coordinator;
    if (!coordinator) return;
    const operationIds = [...this.operations.keys()];
    this.tickInFlight = this.runTick(coordinator, operationIds).finally(() => {
      this.tickInFlight = undefined;
      this.schedule();
    });
    return this.tickInFlight;
  }

  private async runTick(
    coordinator: StepAbortMonitorCoordinator,
    operationIds: string[],
  ): Promise<void> {
    try {
      const interruptedIds = await coordinator.getInterruptSentinels(operationIds);
      this.failures = 0;
      for (const operationId of operationIds) {
        if (interruptedIds.has(operationId)) this.abortOperation(operationId);
      }
    } catch (error) {
      this.failures += 1;
      log('Shared abort monitor MGET failed: %O', error);
      return;
    }

    const now = Date.now();
    for (const operationId of operationIds) {
      const operation = this.operations.get(operationId);
      if (!operation || operation.statusCheckInFlight) continue;
      if (now - operation.lastStatusCheckAt < LEGACY_INTERRUPT_STATE_POLL_INTERVAL_MS) continue;

      operation.lastStatusCheckAt = now;
      operation.statusCheckInFlight = true;
      void coordinator
        .loadAgentStatus(operationId)
        .then((status) => {
          if (status === 'interrupted') this.abortOperation(operationId);
        })
        .catch((error: unknown) => {
          log('[%s] Legacy interrupt status check failed: %O', operationId, error);
        })
        .finally(() => {
          const current = this.operations.get(operationId);
          if (current) current.statusCheckInFlight = false;
        });
    }
  }

  private abortOperation(operationId: string): void {
    const operation = this.operations.get(operationId);
    if (!operation) return;
    for (const controller of operation.controllers) controller.abort();
    this.operations.delete(operationId);
  }
}

const sharedAbortMonitor = new SharedAbortMonitor();

export { sharedAbortMonitor };
