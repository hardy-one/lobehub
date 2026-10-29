import { formatDuration } from '@lobechat/utils';
import { Text } from '@lobehub/ui';
import { memo, useEffect, useState, useSyncExternalStore } from 'react';

interface ExecutionTimeProps {
  isExecuting: boolean;
  startTime?: number;
  timerKey: string;
}

const UPDATE_INTERVAL_MS = 100;
const START_TIME_CACHE_TTL_MS = 60_000;
const executionStartTimeCache = new Map<string, number>();
const executionStartTimeCleanupTimers = new Map<string, number>();

// One clock shared by every running row. Rows used to each own a 100ms
// `setInterval` plus its own state; with a long tool list that is hundreds of
// state updates per second landing while the list is already re-rendering.
const clockListeners = new Set<() => void>();
let clockInterval: number | undefined;
let clockNow = Date.now();

const emitClockTick = () => {
  clockNow = Date.now();
  for (const listener of clockListeners) listener();
};

const subscribeClock = (listener: () => void) => {
  clockListeners.add(listener);
  if (clockInterval === undefined) {
    clockNow = Date.now();
    clockInterval = window.setInterval(emitClockTick, UPDATE_INTERVAL_MS);
  }
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0 && clockInterval !== undefined) {
      window.clearInterval(clockInterval);
      clockInterval = undefined;
    }
  };
};

const getClockNow = () => clockNow;

const noopSubscribe = () => () => {};

const clearExecutionStartTimeCleanup = (timerKey: string) => {
  const cleanupTimer = executionStartTimeCleanupTimers.get(timerKey);
  if (cleanupTimer === undefined) return;

  window.clearTimeout(cleanupTimer);
  executionStartTimeCleanupTimers.delete(timerKey);
};

const scheduleExecutionStartTimeCleanup = (timerKey: string) => {
  clearExecutionStartTimeCleanup(timerKey);

  const cleanupTimer = window.setTimeout(() => {
    executionStartTimeCache.delete(timerKey);
    executionStartTimeCleanupTimers.delete(timerKey);
  }, START_TIME_CACHE_TTL_MS);

  executionStartTimeCleanupTimers.set(timerKey, cleanupTimer);
};

const formatElapsedTime = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;

  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;

  return formatDuration(ms);
};

const ExecutionTime = memo<ExecutionTimeProps>(({ isExecuting, startTime, timerKey }) => {
  const now = useSyncExternalStore(
    isExecuting ? subscribeClock : noopSubscribe,
    getClockNow,
    getClockNow,
  );

  // Resolved once per execution instead of on every tick: the start time is
  // fixed for the duration of the call, so it must not be recomputed per render.
  const [resolvedStartTime, setResolvedStartTime] = useState(0);

  useEffect(() => {
    if (!isExecuting) {
      clearExecutionStartTimeCleanup(timerKey);
      executionStartTimeCache.delete(timerKey);
      setResolvedStartTime(0);
      return;
    }

    clearExecutionStartTimeCleanup(timerKey);
    const startedAt = startTime ?? executionStartTimeCache.get(timerKey) ?? Date.now();
    executionStartTimeCache.set(timerKey, startedAt);
    setResolvedStartTime(startedAt);

    return () => {
      scheduleExecutionStartTimeCleanup(timerKey);
    };
  }, [isExecuting, startTime, timerKey]);

  if (!isExecuting) return null;

  return (
    <Text fontSize={12} style={{ flexShrink: 0, whiteSpace: 'nowrap' }} type="secondary">
      {formatElapsedTime(resolvedStartTime > 0 ? Math.max(0, now - resolvedStartTime) : 0)}
    </Text>
  );
});

export default ExecutionTime;
