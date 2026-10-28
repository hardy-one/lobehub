// @vitest-environment node
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import journal from '../migrations/meta/_journal.json';

const upstream = path.join(__dirname, '../migrations');
const fork = path.join(__dirname, '../migrations-fork');
const forkConfig = { migrationsFolder: fork, migrationsTable: '__lobehub_fork_migrations' };

const hasTable = async (client: PGlite, name: string) =>
  (await client.query<{ exists: boolean }>('select to_regclass($1) is not null as exists', [name]))
    .rows[0].exists;

describe('isolated fork database migrations', () => {
  let historical: string;
  const clients: PGlite[] = [];

  const createDatabase = () => {
    const client = new PGlite({ extensions: { vector } });
    clients.push(client);
    return { client, db: drizzle({ client }) };
  };

  beforeAll(async () => {
    historical = await mkdtemp(path.join(tmpdir(), 'fork-migrations-'));
    await mkdir(path.join(historical, 'meta'));
    const entries = journal.entries.filter(({ idx }) => idx < 191);
    await Promise.all([
      writeFile(
        path.join(historical, 'meta/_journal.json'),
        JSON.stringify({ ...journal, entries }),
      ),
      ...entries.map(({ tag }) =>
        copyFile(path.join(upstream, `${tag}.sql`), path.join(historical, `${tag}.sql`)),
      ),
    ]);
  });

  afterAll(async () => {
    await Promise.all(clients.map((client) => client.close()));
    if (historical) await rm(historical, { force: true, recursive: true });
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

  it('repairs a skipped upstream migration without deleting legacy artifact data', async () => {
    const { client, db } = createDatabase();
    await migrate(db, { migrationsFolder: historical });
    await migrate(db, forkConfig);
    await client.query("insert into users (id) values ('fork-test-user')");
    await client.query(
      "insert into artifact_deployments (id, user_id, topic_id, identifier) values ('existing', 'fork-test-user', 'topic', 'artifact')",
    );
    await client.query('drop table linear_sync_rules, task_external_links');
    await client.query('drop table drizzle.__lobehub_fork_migrations');
    await client.query(
      'insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)',
      ['legacy-artifact', 1793151414944],
    );
    await migrate(db, { migrationsFolder: upstream });
    expect(await hasTable(client, 'public.linear_sync_rules')).toBe(false);
    await migrate(db, forkConfig);
    expect(await hasTable(client, 'public.linear_sync_rules')).toBe(true);
    const rows = await client.query("select id from artifact_deployments where id = 'existing'");
    expect(rows.rows).toHaveLength(1);
  }, 60_000);
});
