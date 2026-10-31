// @vitest-environment node
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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
    const latestSnapshot = async (folder: string) => {
      const journal = JSON.parse(await readFile(path.join(folder, 'meta/_journal.json'), 'utf8'));
      const { idx } = journal.entries.at(-1);
      const file = `meta/${String(idx).padStart(4, '0')}_snapshot.json`;
      return JSON.parse(await readFile(path.join(folder, file), 'utf8'));
    };

    const upstreamSnapshot = await latestSnapshot(upstream);
    const forkSnapshot = await latestSnapshot(fork);

    expect(Object.keys(forkSnapshot.tables).sort()).toEqual([
      'hardy.artifact_deployment_revisions',
      'hardy.artifact_deployments',
    ]);
    expect(Object.keys(forkSnapshot.tables).some((key) => key in upstreamSnapshot.tables)).toBe(
      false,
    );
  });

  it('migrates a new database with independent migration records', async () => {
    const { client, db } = createDatabase();
    await migrate(db, { migrationsFolder: upstream });
    await migrate(db, forkConfig);
    expect(await hasTable(client, 'public.linear_sync_rules')).toBe(true);
    expect(await hasTable(client, 'hardy.artifact_deployments')).toBe(true);
    expect(await hasTable(client, 'public.artifact_deployments')).toBe(false);
    expect(await hasTable(client, 'drizzle.__lobehub_fork_migrations')).toBe(true);
    await migrate(db, forkConfig);
    const journal = JSON.parse(await readFile(path.join(fork, 'meta/_journal.json'), 'utf8'));
    const rows = await client.query('select * from drizzle.__lobehub_fork_migrations');
    expect(rows.rows).toHaveLength(journal.entries.length);
  }, 60_000);

  it('moves legacy public tables into the hardy schema without losing data', async () => {
    const legacy = await mkdtemp(path.join(tmpdir(), 'fork-legacy-'));
    try {
      await mkdir(path.join(legacy, 'meta'));
      const journal = JSON.parse(await readFile(path.join(fork, 'meta/_journal.json'), 'utf8'));
      const entries = journal.entries.filter(({ idx }) => idx < 2);
      await writeFile(
        path.join(legacy, 'meta/_journal.json'),
        JSON.stringify({ ...journal, entries }),
      );
      await Promise.all(
        entries.map(({ tag }) =>
          copyFile(path.join(fork, `${tag}.sql`), path.join(legacy, `${tag}.sql`)),
        ),
      );

      const { client, db } = createDatabase();
      await migrate(db, { migrationsFolder: upstream });
      await migrate(db, {
        migrationsFolder: legacy,
        migrationsTable: '__lobehub_fork_migrations',
      });

      await client.query("insert into users (id) values ('legacy-user')");
      await client.query(
        `insert into public.artifact_deployments (id, user_id, topic_id, identifier)
         values ('legacy', 'legacy-user', 'topic', 'artifact')`,
      );

      await migrate(db, forkConfig);

      expect(await hasTable(client, 'public.artifact_deployments')).toBe(false);
      expect(await hasTable(client, 'hardy.artifact_deployments')).toBe(true);
      const rows = await client.query<{ id: string }>(
        "select id from hardy.artifact_deployments where id = 'legacy'",
      );
      expect(rows.rows).toHaveLength(1);
    } finally {
      await rm(legacy, { force: true, recursive: true });
    }
  }, 60_000);
});
