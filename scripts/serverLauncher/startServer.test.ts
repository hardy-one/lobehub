import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

const launcher = path.join(import.meta.dirname, 'startServer.js');

/** Exercise the real launcher with child processes replaced by deterministic exits. */
const launch = async (
  env: Record<string, string>,
  failure?: { code: number; script: string },
  opts: {
    auditListed?: boolean;
    extraListed?: { destination: string; id: string }[];
    schedulesExpected?: number;
  } = {},
) => {
  const { auditListed = false, extraListed = [], schedulesExpected = 0 } = opts;
  const commands: string[][] = [];
  const exits: number[] = [];
  const logs: string[] = [];
  const scheduleRequests: { id: string; url: string }[] = [];
  let resolveSchedules: () => void;
  const schedulesDone = new Promise<void>((resolve) => {
    resolveSchedules = resolve;
  });
  let resolveListed: () => void;
  const listedDone = new Promise<void>((resolve) => {
    resolveListed = resolve;
  });
  const source = await readFile(launcher, 'utf8');
  const modules: Record<string, unknown> = {
    'node:child_process': {
      spawn: (executable: string, args: string[]) => {
        commands.push([executable, ...args]);
        const child = new EventEmitter();
        queueMicrotask(() => child.emit('close', args[0] === failure?.script ? failure.code : 0));
        return child;
      },
    },
    'node:dns': { promises: { getServers: () => [] } },
    'node:fs': { existsSync: () => true, promises: { access: async () => undefined } },
    'node:path': { join: (...parts: string[]) => parts.join('/') },
  };
  const completion = vm
    .runInNewContext(source, {
      __dirname: '/app',
      console: {
        error: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
        log: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
        warn: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
      },
      fetch: async (url: string, init?: { headers: Record<string, string>; method?: string }) => {
        const href = String(url);
        if (href.endsWith('/v2/health')) return { ok: true };
        if (init?.method === 'POST') {
          scheduleRequests.push({ id: init.headers['Upstash-Schedule-Id'], url: href });
          if (scheduleRequests.length === schedulesExpected) resolveSchedules();
          return { ok: true };
        }
        if (href.endsWith('/v2/schedules')) {
          // The audit's list call: echo back destinations derived from the
          // recorded POST urls so the reconciliation path is exercised too.
          resolveListed();
          return {
            ok: true,
            json: async () => [
              ...scheduleRequests.map((request) => ({
                destination: request.url.slice(
                  request.url.indexOf('/v2/schedules/') + '/v2/schedules/'.length,
                ),
                isPaused: false,
                scheduleId: request.id,
              })),
              ...extraListed.map((row) => ({
                destination: row.destination,
                isPaused: false,
                scheduleId: row.id,
              })),
            ],
          };
        }
        return { ok: true };
      },
      process: {
        env,
        exit: (code: number) => {
          exits.push(code);
          throw new Error('launcher exited');
        },
      },
      require: (name: string) =>
        modules[name] ?? { checkDeprecatedAuth: () => undefined, checkGatewayConfig: () => [] },
    })
    .catch((error: Error) => {
      if (error.message !== 'launcher exited') throw error;
    });
  if (schedulesExpected > 0) await schedulesDone;
  if (auditListed) {
    await listedDone;
    // The audit logs after awaiting the list response body; flush its tail.
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await completion;
  return { commands, exits, logs, scheduleRequests };
};

describe('Docker startup migrations', () => {
  it('finishes PostgreSQL and Elasticsearch migrations before serving requests', async () => {
    const result = await launch({ DATABASE_DRIVER: 'node', FTS_SEARCH_PROVIDER: 'elasticsearch' });
    expect(result.commands).toEqual([
      ['/bin/node', '/app/docker.cjs'],
      ['/bin/node', '/app/fts-search-elasticsearch-reindex.cjs', '--startup', '--yes'],
      ['/bin/node', '/app/server.js'],
    ]);
    expect(result.exits).toEqual([]);
  });

  it('runs PostgreSQL first for Elasticsearch even without an explicit driver', async () => {
    const result = await launch({ FTS_SEARCH_PROVIDER: 'elasticsearch' });
    expect(result.commands.map((command) => command[1])).toEqual([
      '/app/docker.cjs',
      '/app/fts-search-elasticsearch-reindex.cjs',
      '/app/server.js',
    ]);
  });

  it('supplies the migration telemetry environment when Docker telemetry is enabled', async () => {
    const result = await launch({
      ENABLE_TELEMETRY: '1',
      FTS_SEARCH_PROVIDER: 'elasticsearch',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318',
    });
    expect(result.commands).toEqual([
      ['/bin/node', '/app/docker.cjs'],
      [
        '/bin/node',
        '/app/fts-search-elasticsearch-reindex.cjs',
        '--startup',
        '--yes',
        '--telemetry-environment=production',
      ],
      ['/bin/node', '/app/server.js'],
    ]);
    expect(result.exits).toEqual([]);
  });

  it('keeps PostgreSQL-only startup free of Elasticsearch operations', async () => {
    const result = await launch({ DATABASE_DRIVER: 'node', FTS_SEARCH_PROVIDER: 'pg_search' });
    expect(result.commands.map((command) => command[1])).toEqual([
      '/app/docker.cjs',
      '/app/server.js',
    ]);
  });

  it.each(['/app/docker.cjs', '/app/fts-search-elasticsearch-reindex.cjs'])(
    'does not serve requests when %s fails',
    async (script) => {
      const result = await launch(
        { DATABASE_DRIVER: 'node', FTS_SEARCH_PROVIDER: 'elasticsearch' },
        { code: 1, script },
      );
      expect(result.commands.some((command) => command[1] === '/app/server.js')).toBe(false);
      expect(result.exits).toEqual([1]);
    },
  );
});

describe('QStash schedule registration', () => {
  const qstashEnv = { APP_URL: 'https://lobe.example.com', QSTASH_TOKEN: 'tok' };

  it('registers only the quota-safe pair on hosted QStash', async () => {
    const result = await launch(qstashEnv, undefined, { schedulesExpected: 2 });
    expect(result.scheduleRequests.map((request) => request.id)).toEqual([
      'lobe-task-schedule-dispatch',
      'lobe-goal-sweep',
    ]);
    expect(result.scheduleRequests[0].url).toBe(
      'https://qstash-eu-central-1.upstash.io/v2/schedules/https://lobe.example.com/api/workflows/task/schedule-dispatch',
    );
    // Hosted QStash never runs the hellostash audit.
    expect(result.logs.some((line) => line.includes('HelloStash'))).toBe(false);
  });

  it('registers the full sweep set when QSTASH_PROVIDER=hellostash', async () => {
    const result = await launch(
      { ...qstashEnv, QSTASH_PROVIDER: 'hellostash', QSTASH_URL: 'http://hellostash:8080' },
      undefined,
      { auditListed: true, schedulesExpected: 9 },
    );
    expect(result.scheduleRequests.map((request) => request.id)).toEqual([
      'lobe-task-schedule-dispatch',
      'lobe-goal-sweep',
      'lobe-task-scheduled-topic-dispatch',
      'lobe-task-watchdog',
      'lobe-verify-sweep',
      'lobe-trash-purge',
      'lobe-agent-signal-nightly-self-review',
      'lobe-memory-hourly-analysis',
      'lobe-widget-tick',
    ]);
    // The self-hosted queue is reached through QSTASH_URL, and every path is
    // appended to APP_URL — the destination the queue will call back.
    expect(
      result.scheduleRequests.every((request) =>
        request.url.startsWith('http://hellostash:8080/v2/schedules/https://lobe.example.com/api/'),
      ),
    ).toBe(true);
    // The audit probes health, then reconciles the echoed list against the
    // expected set. The mock echoes exactly what was POSTed, so it must pass.
    expect(result.logs.some((line) => line.includes('HelloStash: server reachable'))).toBe(true);
    expect(
      result.logs.some((line) => line.includes('HelloStash: all 9 schedules registered')),
    ).toBe(true);
    expect(result.logs.some((line) => line.includes('is missing'))).toBe(false);
    expect(result.logs.some((line) => line.includes('unmanaged'))).toBe(false);
  });

  it('routes schedule destinations through QSTASH_CALLBACK_BASE_URL when set', async () => {
    // A self-hosted queue on the deployment network reaches the app over an
    // internal address; APP_URL stays the public, browser-facing URL.
    const result = await launch(
      {
        ...qstashEnv,
        QSTASH_CALLBACK_BASE_URL: 'http://lobe:3210',
        QSTASH_PROVIDER: 'hellostash',
        QSTASH_URL: 'http://hellostash:8080',
      },
      undefined,
      { auditListed: true, schedulesExpected: 9 },
    );

    expect(
      result.scheduleRequests.every((request) =>
        request.url.startsWith('http://hellostash:8080/v2/schedules/http://lobe:3210/api/'),
      ),
    ).toBe(true);
    // The audit compares stored destinations against the same base, so it must
    // report success rather than a mismatch.
    expect(result.logs.some((line) => line.includes('registered against http://lobe:3210'))).toBe(
      true,
    );
    expect(result.logs.some((line) => line.includes('does not match the callback base'))).toBe(
      false,
    );
  });

  it('flags a stale unmanaged schedule during the hellostash audit', async () => {
    // A hand-created schedule from before auto-registration lingers alongside
    // the managed set; the audit must warn so it gets deleted instead of
    // double-firing.
    const result = await launch(
      { ...qstashEnv, QSTASH_PROVIDER: 'hellostash', QSTASH_URL: 'http://hellostash:8080' },
      undefined,
      {
        auditListed: true,
        extraListed: [{ destination: 'https://other.example.com/x', id: 'lobe-nightly-old' }],
        schedulesExpected: 9,
      },
    );
    expect(
      result.logs.some(
        (line) =>
          line.includes('unmanaged schedule lobe-nightly-old') && line.includes('double-fire'),
      ),
    ).toBe(true);
  });
});
