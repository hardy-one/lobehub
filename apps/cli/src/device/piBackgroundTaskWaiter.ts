import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_DISCOVERY_WINDOW_MS = 1_000;
const DEFAULT_POLL_INTERVAL_MS = 500;
const DEFAULT_PROCESS_EXIT_GRACE_MS = 2_000;
const DEFAULT_MAX_WAIT_MS = 6 * 60 * 60 * 1000;

interface TaskState {
  id: string;
  pid?: number;
  status: string;
}

export interface PiBackgroundTaskWait {
  cancel: () => void;
  completion: Promise<void>;
}

export interface PiBackgroundTaskWaiterOptions {
  discoveryWindowMs?: number;
  maxWaitMs?: number;
  pollIntervalMs?: number;
  processExitGraceMs?: number;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });

const taskRoot = (cwd: string): string => path.join(cwd, '.pi', 'tasks');
const sanitizeSessionId = (sessionId: string): string =>
  sessionId.replaceAll(/[^\w.-]+/g, '-').replaceAll(/^-+|-+$/g, '') || 'session';

const isRunning = (state: TaskState): boolean =>
  state.status === 'running' || state.status === 'unknown';

const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/**
 * Read metadata owned by one Pi process. pi-background-tasks creates
 * `.pi/tasks/<sanitized-session-id>-<pid>/` before it starts a task.
 */
const readTaskStates = async (
  cwd: string,
  pid: number,
  sessionId?: string,
): Promise<TaskState[]> => {
  const root = taskRoot(cwd);
  let directories;
  try {
    directories = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const pidSuffix = `-${String(pid)}`;
  const expectedDirectory = sessionId ? `${sanitizeSessionId(sessionId)}${pidSuffix}` : undefined;
  const hasExpectedDirectory =
    expectedDirectory !== undefined &&
    directories.some(
      (directory) => directory.isDirectory() && directory.name === expectedDirectory,
    );
  const states: TaskState[] = [];

  for (const directory of directories) {
    if (!directory.isDirectory()) continue;
    const matchesExpected =
      expectedDirectory !== undefined && hasExpectedDirectory
        ? directory.name === expectedDirectory
        : directory.name.endsWith(pidSuffix);
    if (!matchesExpected) continue;
    let files;
    try {
      files = await readdir(path.join(root, directory.name), { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }

    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith('.json') || file.name.endsWith('.attestation.json'))
        continue;
      const id = file.name.slice(0, -'.json'.length);
      try {
        const metadata = JSON.parse(
          await readFile(path.join(root, directory.name, file.name), 'utf8'),
        ) as { pid?: unknown; status?: unknown };
        states.push({
          id,
          ...(typeof metadata.pid === 'number' ? { pid: metadata.pid } : {}),
          status: typeof metadata.status === 'string' ? metadata.status : 'unknown',
        });
      } catch {
        // A partially written file is live until the next poll proves otherwise.
        states.push({ id, status: 'unknown' });
      }
    }
  }

  return states;
};

const discoverRunningTaskIds = async (
  cwd: string,
  pid: number,
  sessionId: string | undefined,
  discoveryWindowMs: number,
  pollIntervalMs: number,
): Promise<Set<string>> => {
  const deadline = Date.now() + discoveryWindowMs;
  for (;;) {
    const running = new Set(
      (await readTaskStates(cwd, pid, sessionId)).filter(isRunning).map(({ id }) => id),
    );
    if (running.size > 0 || Date.now() >= deadline) return running;
    await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
  }
};

const waitForTaskIds = async (
  cwd: string,
  pid: number,
  sessionId: string | undefined,
  ids: Set<string>,
  signal: AbortSignal,
  maxWaitMs: number,
  pollIntervalMs: number,
  processExitGraceMs: number,
): Promise<void> => {
  const deadline = Date.now() + maxWaitMs;
  const missingSince = new Map<string, number>();
  const deadSince = new Map<string, number>();

  for (;;) {
    if (signal.aborted) throw new Error('Pi background task wait cancelled');

    const now = Date.now();
    const states = new Map(
      (await readTaskStates(cwd, pid, sessionId)).map((state) => [state.id, state]),
    );
    let live = false;

    for (const id of ids) {
      const state = states.get(id);
      if (!state) {
        const firstMissingAt = missingSince.get(id) ?? now;
        missingSince.set(id, firstMissingAt);
        if (now - firstMissingAt >= processExitGraceMs) {
          throw new Error(
            `Pi background task ${id} disappeared before terminal metadata was written`,
          );
        }
        live = true;
        continue;
      }

      missingSince.delete(id);
      if (!isRunning(state)) {
        deadSince.delete(id);
        continue;
      }

      if (state.pid !== undefined && !isProcessAlive(state.pid)) {
        const firstDeadAt = deadSince.get(id) ?? now;
        deadSince.set(id, firstDeadAt);
        if (now - firstDeadAt >= processExitGraceMs) {
          throw new Error(`Pi background task ${id} exited before terminal metadata was written`);
        }
      } else {
        deadSince.delete(id);
      }
      live = true;
    }

    if (!live) return;
    if (now >= deadline) {
      throw new Error(`Pi background tasks did not finish within ${maxWaitMs}ms`);
    }
    await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - now)));
  }
};

/**
 * Detect tasks started by the current Pi process. No task returns immediately;
 * discovered tasks are polled until terminal metadata is written or a bounded
 * failure condition is reached.
 */
export async function waitForPiBackgroundTasks(
  cwd: string,
  pid: number | undefined,
  sessionId?: string,
  options: PiBackgroundTaskWaiterOptions = {},
): Promise<PiBackgroundTaskWait | undefined> {
  if (!pid) return undefined;

  const discoveryWindowMs = options.discoveryWindowMs ?? DEFAULT_DISCOVERY_WINDOW_MS;
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const processExitGraceMs = options.processExitGraceMs ?? DEFAULT_PROCESS_EXIT_GRACE_MS;
  const ids = await discoverRunningTaskIds(cwd, pid, sessionId, discoveryWindowMs, pollIntervalMs);
  if (ids.size === 0) return undefined;

  const controller = new AbortController();
  return {
    cancel: () => controller.abort(),
    completion: waitForTaskIds(
      cwd,
      pid,
      sessionId,
      ids,
      controller.signal,
      maxWaitMs,
      pollIntervalMs,
      processExitGraceMs,
    ),
  };
}
