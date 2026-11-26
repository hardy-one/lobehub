// @vitest-environment node
// LOBE-368 review: characterize the bounded-window pagination regression across pages.
import { writeFileSync } from 'node:fs';

import { LayersEnum } from '@lobechat/types';
import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { getTestDB } from '../../../../core/getTestDB';
import { userMemories, userMemoriesContexts, users } from '../../../../schemas';
import type { LobeChatDatabase } from '../../../../type';
import { UserMemoryModel } from '../../model';

const userId = 'lobe368-pages-user';
const serverDB: LobeChatDatabase = await getTestDB();
const model = new UserMemoryModel(serverDB, userId);
const out = process.env.LOBE368_PAGE_OUT;
if (!out) throw new Error('LOBE368_PAGE_OUT required');
const baseTime = Date.parse('2024-01-01T00:00:00.000Z');
const at = (m: number) => new Date(baseTime + m * 60_000);

const parents = [
  { id: 'q-A1', at: at(1) },
  { id: 'q-A2', at: at(2) },
  { id: 'q-S1', at: at(3), deleted: true },
  { id: 'q-S2', at: at(4), deleted: true },
  { id: 'q-S3', at: at(5), deleted: true },
  { id: 'q-E1', at: at(6) },
  { id: 'q-F1', at: at(7) },
  { id: 'q-G1', at: at(8) },
  { id: 'q-H1', at: at(9) },
] as const;
// desc capturedAt: A(60) B(50) C(40) D(30) E(20) F(10) G(5) H(1)
const contexts = [
  { id: 'q-A', capturedAt: at(60), ids: ['q-A1', 'q-A2'] },
  { id: 'q-B', capturedAt: at(50), ids: ['q-S1'] },
  { id: 'q-C', capturedAt: at(40), ids: ['q-S2'] },
  { id: 'q-D', capturedAt: at(30), ids: ['q-S3'] },
  { id: 'q-E', capturedAt: at(20), ids: ['q-E1'] },
  { id: 'q-F', capturedAt: at(10), ids: ['q-F1'] },
  { id: 'q-G', capturedAt: at(5), ids: ['q-G1'] },
  { id: 'q-H', capturedAt: at(1), ids: ['q-H1'] },
] as const;

beforeAll(async () => {
  await serverDB.delete(users).where(inArray(users.id, [userId]));
  await serverDB.insert(users).values([{ id: userId }]);
  await serverDB.insert(userMemories).values(
    parents.map((p) => ({
      createdAt: p.at,
      id: p.id,
      isDeleted: 'deleted' in p ? p.deleted : false,
      lastAccessedAt: p.at,
      memoryLayer: LayersEnum.Context,
      userId,
    })),
  );
  await serverDB.insert(userMemoriesContexts).values(
    contexts.map((c) => ({
      capturedAt: c.capturedAt,
      createdAt: c.capturedAt,
      currentStatus: 'active',
      id: c.id,
      title: c.id,
      type: 'project',
      updatedAt: c.capturedAt,
      userMemoryIds: c.ids,
      userId,
    })),
  );
});
afterAll(async () => {
  await serverDB.delete(users).where(inArray(users.id, [userId]));
});

describe('LOBE-368 multi-page characterization', () => {
  it('pages 1..4 size 2', async () => {
    const results = [];
    for (const page of [1, 2, 3, 4]) {
      const r = await model.queryMemories({
        layer: LayersEnum.Context,
        order: 'desc',
        page,
        pageSize: 2,
      });
      results.push({
        page,
        pairs: r.items.map((i) => [
          (i.context as { id: string }).id,
          (i.memory as { id: string }).id,
        ]),
        total: r.total,
      });
    }
    writeFileSync(out, JSON.stringify(results, null, 2) + '\n');
    console.log('PAGE_RESULTS', JSON.stringify(results));
  });
});
