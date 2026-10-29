// @vitest-environment node
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, describe, expect, it } from 'vitest';

const upstream = path.join(__dirname, '../migrations');
const fork = path.join(__dirname, '../migrations-fork');
const forkConfig = { migrationsFolder: fork, migrationsTable: '__lobehub_fork_migrations' };

const hasTable = async (client: PGlite, name: string) =>
  (await client.query<{ exists: boolean }>('select to_regclass($1) is not null as exists', [name]))
    .rows[0].exists;

describe('isolated fork database migrations', () => {
  const clients: PGlite[] = [];

  const createDatabase = () => {
    const client = new PGlite({ extensions: { vector } });
    clients.push(client);
    return { client, db: drizzle({ client }) };
  };

  afterAll(async () => {
    await Promise.all(clients.map((client) => client.close()));
  });

  it('keeps upstream and fork snapshots in separate migration chains', async () => {
    const upstreamSnapshot = JSON.parse(
      await readFile(path.join(upstream, 'meta/0191_snapshot.json'), 'utf8'),
    );
    const forkSnapshot = JSON.parse(
      await readFile(path.join(fork, 'meta/0000_snapshot.json'), 'utf8'),
    );
    expect(Object.keys(forkSnapshot.tables).sort()).toEqual([
      'public.artifact_deployment_revisions',
      'public.artifact_deployments',
    ]);
    expect(upstreamSnapshot.tables['public.artifact_deployments']).toBeUndefined();
    expect(forkSnapshot.tables['public.linear_sync_rules']).toBeUndefined();
  });

  it('migrates a new database with independent migration records', async () => {
    const { client, db } = createDatabase();
    await migrate(db, { migrationsFolder: upstream });
    await migrate(db, forkConfig);
    expect(await hasTable(client, 'public.linear_sync_rules')).toBe(true);
    expect(await hasTable(client, 'public.artifact_deployments')).toBe(true);
    expect(await hasTable(client, 'drizzle.__lobehub_fork_migrations')).toBe(true);
    await migrate(db, forkConfig);
    const rows = await client.query('select * from drizzle.__lobehub_fork_migrations');
    expect(rows.rows).toHaveLength(1);
  }, 60_000);
});
