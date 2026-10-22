import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { waitForPiBackgroundTasks } from './piBackgroundTaskWaiter';

const pid = 123_456;
const taskDirectory = (cwd: string, sessionId = `session-${pid}`) =>
  path.join(cwd, '.pi', 'tasks', sessionId);

const writeTask = async (
  cwd: string,
  id: string,
  status: string,
  options: { pid?: number; sessionId?: string } = {},
) => {
  await mkdir(taskDirectory(cwd, options.sessionId), { recursive: true });
  await writeFile(
    path.join(taskDirectory(cwd, options.sessionId), `${id}.json`),
    JSON.stringify({ ...(options.pid === undefined ? {} : { pid: options.pid }), status }),
  );
};

describe('waitForPiBackgroundTasks', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { force: true, recursive: true })),
    );
  });

  it('ignores completed tasks and returns no wait when there is no live task', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'pi-task-waiter-'));
    temporaryDirectories.push(cwd);
    await writeTask(cwd, 'b-completed', 'completed');
    await writeTask(cwd, 'b-failed', 'failed');
    await writeTask(cwd, 'b-killed', 'killed');

    await writeFile(
      path.join(taskDirectory(cwd), 'b-attested.attestation.json'),
      JSON.stringify({ attestation: true }),
    );
    await expect(waitForPiBackgroundTasks(cwd, pid)).resolves.toBeUndefined();
  });

  it('waits for all tasks owned by the Pi process to reach terminal states', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'pi-task-waiter-'));
    temporaryDirectories.push(cwd);
    await writeTask(cwd, 'b-docker', 'running');
    await writeTask(cwd, 'b-other', 'running');

    const wait = await waitForPiBackgroundTasks(cwd, pid, undefined, {
      discoveryWindowMs: 0,
      pollIntervalMs: 5,
    });
    expect(wait).toBeDefined();

    setTimeout(async () => {
      await writeTask(cwd, 'b-docker', 'completed');
      await writeTask(cwd, 'b-other', 'failed');
    }, 20).unref?.();

    await expect(wait!.completion).resolves.toBeUndefined();
  });

  it('matches the native Pi session directory when one is available', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'pi-task-waiter-'));
    temporaryDirectories.push(cwd);
    await writeTask(cwd, 'b-other', 'running', { sessionId: `other-${pid}` });
    await writeTask(cwd, 'b-owned', 'running', { sessionId: `native-session-${pid}` });

    const wait = await waitForPiBackgroundTasks(cwd, pid, 'native/session', {
      discoveryWindowMs: 0,
      pollIntervalMs: 5,
    });
    expect(wait).toBeDefined();

    await writeTask(cwd, 'b-owned', 'completed', { sessionId: `native-session-${pid}` });
    await expect(wait!.completion).resolves.toBeUndefined();
  });

  it('falls back to the process PID when the native session directory is unavailable', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'pi-task-waiter-'));
    temporaryDirectories.push(cwd);
    await writeTask(cwd, 'b-fallback', 'running', { sessionId: `fallback-${pid}` });

    const wait = await waitForPiBackgroundTasks(cwd, pid, 'missing/session', {
      discoveryWindowMs: 0,
      pollIntervalMs: 5,
    });
    expect(wait).toBeDefined();

    await writeTask(cwd, 'b-fallback', 'completed', { sessionId: `fallback-${pid}` });
    await expect(wait!.completion).resolves.toBeUndefined();
  });

  it('fails instead of waiting forever when a task process disappears', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'pi-task-waiter-'));
    temporaryDirectories.push(cwd);
    await writeTask(cwd, 'b-dead', 'running', { pid: 99_999_999 });

    const wait = await waitForPiBackgroundTasks(cwd, pid, undefined, {
      discoveryWindowMs: 0,
      pollIntervalMs: 5,
      processExitGraceMs: 20,
      maxWaitMs: 100,
    });
    expect(wait).toBeDefined();
    await expect(wait!.completion).rejects.toThrow('exited before terminal metadata');
  });

  it('treats an unreadable metadata file as live until it becomes terminal', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'pi-task-waiter-'));
    temporaryDirectories.push(cwd);
    await mkdir(taskDirectory(cwd), { recursive: true });
    const metadataPath = path.join(taskDirectory(cwd), 'b-partial.json');
    await writeFile(metadataPath, '{');

    const wait = await waitForPiBackgroundTasks(cwd, pid, undefined, {
      discoveryWindowMs: 0,
      pollIntervalMs: 5,
    });
    expect(wait).toBeDefined();

    setTimeout(async () => {
      await writeFile(metadataPath, JSON.stringify({ status: 'killed' }));
    }, 20).unref?.();

    await expect(wait!.completion).resolves.toBeUndefined();
  });

  it('stops promptly when the host cancels the wait', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'pi-task-waiter-'));
    temporaryDirectories.push(cwd);
    await writeTask(cwd, 'b-cancelled', 'running');

    const wait = await waitForPiBackgroundTasks(cwd, pid, undefined, {
      discoveryWindowMs: 0,
      pollIntervalMs: 5,
    });
    expect(wait).toBeDefined();

    wait!.cancel();
    await expect(wait!.completion).rejects.toThrow('wait cancelled');
  });

  it('fails when a task exceeds the bounded wait', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'pi-task-waiter-'));
    temporaryDirectories.push(cwd);
    await writeTask(cwd, 'b-timeout', 'running');

    const wait = await waitForPiBackgroundTasks(cwd, pid, undefined, {
      discoveryWindowMs: 0,
      maxWaitMs: 20,
      pollIntervalMs: 5,
    });
    expect(wait).toBeDefined();
    await expect(wait!.completion).rejects.toThrow('did not finish within 20ms');
  });
});
