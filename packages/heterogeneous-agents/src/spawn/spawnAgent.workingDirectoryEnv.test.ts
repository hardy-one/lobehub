import type * as childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import type * as os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { afterAll, describe, expect, it, vi } from 'vitest';

const spawnCalls: Array<{ args: string[]; command: string; options: any }> = [];

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof childProcess>('node:child_process');
  return {
    ...actual,
    execFile: vi.fn(),
    spawn: vi.fn((command: string, args: string[], options: any) => {
      spawnCalls.push({ args, command, options });

      const proc = new EventEmitter() as any;
      proc.stdout = new PassThrough();
      proc.stderr = new PassThrough();
      proc.stdin = { end: vi.fn(), once: vi.fn(), write: vi.fn() };
      proc.kill = vi.fn();
      proc.killed = false;
      proc.pid = 12_345;

      return proc;
    }),
  };
});

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof os>('node:os');
  return { ...actual, platform: vi.fn(() => 'linux') };
});

const realOs = await vi.importActual<typeof os>('node:os');
const launcherDir = realOs.tmpdir();
const workDir = await mkdtemp(path.join(realOs.tmpdir(), 'hetero-spawn-env-'));

afterAll(() => rm(workDir, { force: true, recursive: true }));

describe('spawnAgent working-directory environment', () => {
  it("points PWD at the child's cwd instead of the launcher's", async () => {
    // The launcher sits in its own directory — the `lh connect` daemon's case.
    process.env.PWD = launcherDir;

    const { spawnAgent } = await import('./spawnAgent');
    await spawnAgent({ agentType: 'opencode', cwd: workDir, prompt: 'hi' });

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]!.options.cwd).toBe(workDir);
    // OpenCode resolves its project from PWD, so a stale value opens the
    // launcher's directory for every conversation.
    expect(spawnCalls[0]!.options.env.PWD).toBe(workDir);
  });
});
