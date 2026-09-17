import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PiRpcConnectionError, PiRpcResponseError } from './piRpcClient';
import { probePiThinkingLevels } from './probePiThinkingLevels';

const { execFileMock, spawnMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  spawnMock: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    execFile: (...args: unknown[]) => {
      const probe = execFileMock(...args);
      if (probe) return probe;
      const exited = new EventEmitter();
      queueMicrotask(() => exited.emit('close', 0, null));
      return exited;
    },
    spawn: spawnMock,
  };
});

interface ResponderOptions {
  /** Answer `get_available_thinking_levels` with a failure instead of a list. */
  failLevelsQuery?: boolean;
  levels?: string[];
}

/**
 * Fixture process that answers every RPC command by itself, so the probe drives
 * a full handshake + query without the test having to interleave writes.
 */
const createResponderProcess = ({
  failLevelsQuery,
  levels = ['off', 'low', 'high'],
}: ResponderOptions = {}) => {
  const child = new EventEmitter() as any;
  const stdout = new PassThrough();
  const writes: Array<Record<string, unknown>> = [];

  child.pid = 424_242;
  child.killed = false;
  child.exitCode = null;
  child.signalCode = null;
  child.kill = vi.fn(() => true);
  child.stdout = stdout;
  child.stderr = new PassThrough();
  child.stdinEnd = vi.fn(() => {
    setTimeout(() => child.emit('close', 0, null), 1);
  });
  child.stdin = {
    end: child.stdinEnd,
    once: vi.fn(),
    write: vi.fn((chunk: string) => {
      const command = JSON.parse(chunk.trim());
      writes.push(command);

      let data: Record<string, unknown> | undefined;
      if (command.type === 'get_state') {
        data = {
          model: { id: 'claude-sonnet-4-5', name: 'Sonnet 4.5' },
          sessionId: 'sess-probe',
          thinkingLevel: 'low',
        };
      } else if (command.type === 'get_available_thinking_levels') {
        data = { levels };
      }

      const success = !(failLevelsQuery && command.type === 'get_available_thinking_levels');
      setImmediate(() => {
        stdout.write(
          `${JSON.stringify({
            command: command.type,
            ...(data === undefined ? {} : { data }),
            id: command.id,
            ...(success ? {} : { error: 'thinking levels unavailable' }),
            success,
            type: 'response',
          })}\n`,
        );
      });

      return true;
    }),
  };

  return { child, stdout, writes };
};

beforeEach(() => {
  execFileMock.mockImplementation((_command, _args, _options, callback) => {
    callback(null, '0.80.5\n', '');
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  execFileMock.mockReset();
  spawnMock.mockReset();
});

describe('probePiThinkingLevels', () => {
  it('spawns pi with the run args and returns the model-specific levels', async () => {
    const { child, writes } = createResponderProcess({ levels: ['off', 'medium', 'high'] });
    spawnMock.mockReturnValue(child);

    const result = await probePiThinkingLevels({
      args: ['--provider', 'anthropic', '--model', 'anthropic/claude-sonnet-4-5'],
      commandPath: 'pi',
      cwd: '/workspace',
      env: { ...process.env },
    });

    // pi derives the list from the model, so the probe must bind the same args.
    expect(JSON.stringify(spawnMock.mock.calls[0])).toContain('--model');
    expect(writes.map((write) => write.type)).toEqual([
      'get_state',
      'get_available_thinking_levels',
    ]);
    expect(result).toEqual({
      levels: ['off', 'medium', 'high'],
      model: { id: 'claude-sonnet-4-5', name: 'Sonnet 4.5' },
      thinkingLevel: 'low',
    });
  });

  it('closes the probe process once the query settles', async () => {
    const { child } = createResponderProcess();
    spawnMock.mockReturnValue(child);

    await probePiThinkingLevels({ commandPath: 'pi', cwd: '/workspace', env: { ...process.env } });

    expect(child.stdinEnd).toHaveBeenCalled();
  });

  it('surfaces a failed levels query and still closes the process', async () => {
    const { child } = createResponderProcess({ failLevelsQuery: true });
    spawnMock.mockReturnValue(child);

    await expect(
      probePiThinkingLevels({ commandPath: 'pi', cwd: '/workspace', env: { ...process.env } }),
    ).rejects.toBeInstanceOf(PiRpcResponseError);
    expect(child.stdinEnd).toHaveBeenCalled();
  });

  it('rejects when the process never answers the handshake', async () => {
    const child = new EventEmitter() as any;
    child.pid = 1;
    child.killed = false;
    child.exitCode = null;
    child.signalCode = null;
    // The probe closes the process in its `finally`; a fixture that never exits
    // would leave the graceful-close path waiting forever.
    child.kill = vi.fn(() => {
      child.emit('close', null, 'SIGTERM');
      return true;
    });
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = {
      end: vi.fn(() => {
        child.emit('close', 0, null);
      }),
      once: vi.fn(),
      write: vi.fn(() => true),
    };
    spawnMock.mockReturnValue(child);

    await expect(
      probePiThinkingLevels({
        commandPath: 'pi',
        cwd: '/workspace',
        env: { ...process.env },
        handshakeTimeoutMs: 20,
      }),
    ).rejects.toBeInstanceOf(PiRpcConnectionError);
  });
});
