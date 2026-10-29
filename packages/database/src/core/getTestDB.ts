import { drizzle as nodeDrizzle } from 'drizzle-orm/node-postgres';
import { migrate as nodeMigrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle as pgliteDrizzle } from 'drizzle-orm/pglite';
import { migrate as pgliteMigrate } from 'drizzle-orm/pglite/migrator';
import { Pool as NodePool } from 'pg';

import { serverDBEnv } from '@/config/db';

import * as schema from '../schemas';
import type { LobeChatDatabase } from '../type';
import {
  createPGlite,
  forkMigrationsFolder,
  forkMigrationTable,
  migrationsFolder,
  readPGliteSnapshot,
} from './pgliteSnapshot';

const isServerDBMode = process.env.TEST_SERVER_DB === '1';

let testClientDB: ReturnType<typeof pgliteDrizzle<typeof schema>> | null = null;
let testServerDB: ReturnType<typeof nodeDrizzle<typeof schema>> | null = null;

export const getTestDB = async (): Promise<LobeChatDatabase> => {
  // Server DB mode (node-postgres)
  if (isServerDBMode) {
    if (testServerDB) return testServerDB as unknown as LobeChatDatabase;

    const connectionString = serverDBEnv.DATABASE_TEST_URL;

    if (!connectionString) {
      throw new Error('DATABASE_TEST_URL is not set');
    }

    const client = new NodePool({ connectionString });
    testServerDB = nodeDrizzle(client, { schema });

    await nodeMigrate(testServerDB, { migrationsFolder });
    await nodeMigrate(testServerDB, {
      migrationsFolder: forkMigrationsFolder,
      migrationsTable: forkMigrationTable,
    });

    return testServerDB as unknown as LobeChatDatabase;
  }

  // Client DB mode (PGlite)
  if (testClientDB) return testClientDB as unknown as LobeChatDatabase;

  const snapshot = readPGliteSnapshot();
  const pglite = createPGlite(snapshot);
  testClientDB = pgliteDrizzle({ client: pglite, schema });

  // The global setup's snapshot is already migrated; without it, migrate here.
  // pg_search migrations skip themselves when the extension is unavailable, as in PGlite.
  if (!snapshot) await pgliteMigrate(testClientDB, { migrationsFolder });
  // The fork chain is separate, so it also runs on top of a snapshot that
  // already carries it: drizzle skips the migrations it has recorded.
  await pgliteMigrate(testClientDB, {
    migrationsFolder: forkMigrationsFolder,
    migrationsTable: forkMigrationTable,
  });

  return testClientDB as unknown as LobeChatDatabase;
};
