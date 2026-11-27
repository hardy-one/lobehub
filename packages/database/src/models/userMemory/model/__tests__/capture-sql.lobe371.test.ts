// @vitest-environment node
import { appendFileSync, writeFileSync } from 'node:fs';

import { LayersEnum } from '@lobechat/types';
import { inArray } from 'drizzle-orm';
import { drizzle as nodeDrizzle } from 'drizzle-orm/node-postgres';
import { drizzle as pgProxyDrizzle } from 'drizzle-orm/pg-proxy';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { getTestDatabaseUrl } from '../../../../core/getTestDB';
import { userMemories, userMemoriesContexts, users } from '../../../../schemas';
import type { LobeChatDatabase } from '../../../../type';
import { UserMemoryModel } from '../../model';

const outputDir = process.env.LOBE367_SQL_OUT;
if (!outputDir) throw new Error('LOBE367_SQL_OUT is required');
const head = process.env.LOBE367_HEAD ?? 'unknown';
const captureId = process.env.LOBE367_CAPTURE_ID ?? 'unknown';

const connectionString = await getTestDatabaseUrl();
const adminPool = new Pool({ connectionString, max: 2 });
const statements: Array<{ sql: string; params: unknown[] }> = [];
const proxyCallback = async (sql: string, params: unknown[]) => {
  statements.push({ sql, params });
  return { rows: [], rowCount: 0 };
};
const proxyDB = pgProxyDrizzle(proxyCallback) as unknown as LobeChatDatabase;

const getDB = async () => {
  const { Pool: NodePool } = await import('pg');
  const pool = new NodePool({ connectionString, max: 2 });
  return { db: nodeDrizzle(pool) as unknown as LobeChatDatabase, pool };
};

const { db: serverDB, pool } = await getDB();

const userId = 'lobe367-sql-capture-user';
const otherUserId = 'lobe367-sql-capture-other';
const baseTime = Date.parse('2024-01-01T00:00:00.000Z');
const createdAt = (minutes: number) => new Date(baseTime + minutes * 60_000);

const memoryFixtures = [
  { id: 'l367-p1', createdAt: createdAt(1), tags: ['memorytag'] },
  { id: 'l367-p2', createdAt: createdAt(2), tags: [] },
  { id: 'l367-p3', createdAt: createdAt(3), tags: [] },
  { id: 'l367-p4', createdAt: createdAt(4), tags: [] },
] as const;
const contextFixtures = [
  {
    id: 'l367-c1',
    userMemoryId: 'l367-p1',
    userMemoryIds: null,
    createdAt: createdAt(101),
    updatedAt: createdAt(201),
  },
  {
    id: 'l367-c2',
    userMemoryId: null,
    userMemoryIds: ['l367-p1', 'l367-p2'],
    createdAt: createdAt(102),
    updatedAt: createdAt(202),
  },
  {
    id: 'l367-c3',
    userMemoryId: 'l367-p3',
    userMemoryIds: null,
    createdAt: createdAt(103),
    updatedAt: createdAt(203),
  },
] as const;

const seed = async () => {
  await serverDB.delete(users).where(inArray(users.id, [userId, otherUserId]));
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(userMemories).values(
    memoryFixtures.map((fixture) => ({
      createdAt: fixture.createdAt,
      id: fixture.id,
      lastAccessedAt: fixture.createdAt,
      memoryLayer: LayersEnum.Context,
      tags: [...fixture.tags],
      userId,
    })),
  );
  await serverDB.insert(userMemoriesContexts).values(
    contextFixtures.map((fixture) => ({
      ...fixture,
      title: fixture.id,
      type: 'project',
      userId,
    })),
  );
};

beforeAll(seed);
afterAll(async () => {
  await serverDB.delete(users).where(inArray(users.id, [userId, otherUserId]));
  await pool.end();
  await adminPool.end();
});

describe('LOBE-367 generated SQL capture', () => {
  it('captures page, list and total SQL from the final head implementation', async () => {
    const render = (statement: { sql: string; params: unknown[] }, label: string, page: number) =>
      [
        `head=${head}`,
        `captured_at_utc=${new Date().toISOString()}`,
        `capture=${captureId}`,
        `method=${label}`,
        `page=${page}`,
        '=====SQL=====',
        statement.sql,
        `PARAMS ${JSON.stringify(statement.params)}`,
      ].join('\n');

    const transcript: string[] = [
      `head=${head}`,
      `capture=${captureId}`,
      `generated_at_utc=${new Date().toISOString()}`,
      `methods=UserMemoryModel.queryMemories,UserMemoryModel.listMemories`,
    ];

    for (const page of [1, 2, 4]) {
      statements.length = 0;
      const params = { layer: LayersEnum.Context, page, pageSize: 2 };
      const model = new UserMemoryModel(proxyDB, userId);
      await model.queryMemories(params);
      await model.listMemories(params);
      if (statements.length < 3) {
        throw new Error(`unexpected statement count on page ${page}: ${statements.length}`);
      }
      const suffix = page === 2 ? '' : `-page${page}`;
      writeFileSync(
        `${outputDir}/queryMemories${suffix}.generated.sql`,
        render(statements[0], 'queryMemories', page),
      );
      writeFileSync(
        `${outputDir}/totalMemories${suffix}.generated.sql`,
        render(statements[1], 'queryMemories.total', page),
      );
      writeFileSync(
        `${outputDir}/listMemories${suffix}.generated.sql`,
        render(statements[2], 'listMemories', page),
      );
      transcript.push(`params=${JSON.stringify(params)}`);
      transcript.push(
        ...statements.map(
          (statement, index) =>
            `STATEMENT page=${page} index=${index}\n${statement.sql}\nPARAMS ${JSON.stringify(statement.params)}`,
        ),
      );
      appendFileSync(
        `${outputDir}/capture-index.txt`,
        `${new Date().toISOString()} ${head} page=${page} statements=${statements.length}\n`,
      );
    }
    writeFileSync(`${outputDir}/capture-transcript.txt`, transcript.concat('').join('\n'));
  });
});
