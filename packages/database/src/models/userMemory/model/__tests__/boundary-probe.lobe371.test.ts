// @vitest-environment node
// LOBE-371: bounded-pair probe with exact baseline-compatible query/list output.
import { writeFileSync } from 'node:fs';

import { LayersEnum } from '@lobechat/types';
import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { getTestDB } from '../../../../core/getTestDB';
import { userMemories, userMemoriesContexts, users } from '../../../../schemas';
import type { LobeChatDatabase } from '../../../../type';
import { UserMemoryModel } from '../../model';

const userId = 'lobe371-boundary-user';
const serverDB: LobeChatDatabase = await getTestDB();
const model = new UserMemoryModel(serverDB, userId);
const out = process.env.LOBE371_PROBE_OUT;
if (!out) throw new Error('LOBE371_PROBE_OUT required');
const baseTime = Date.parse('2024-01-01T00:00:00.000Z');
const at = (minutes: number) => new Date(baseTime + minutes * 60_000);

const parents = [
  { id: 'bp-A1', at: at(1) },
  { id: 'bp-A2', at: at(2) },
  { id: 'bp-S1', at: at(3), deleted: true },
  { id: 'bp-S2', at: at(4), deleted: true },
  { id: 'bp-S3', at: at(5), deleted: true },
  { id: 'bp-E1', at: at(6) },
  { id: 'bp-F1', at: at(7) },
] as const;

const contexts = [
  { id: 'bc-A', capturedAt: at(60), ids: ['bp-A1', 'bp-A2'] },
  { id: 'bc-B', capturedAt: at(50), ids: ['bp-S1'] },
  { id: 'bc-C', capturedAt: at(40), ids: ['bp-S2'] },
  { id: 'bc-D', capturedAt: at(30), ids: ['bp-S3'] },
  { id: 'bc-E', capturedAt: at(20), ids: ['bp-E1'] },
  { id: 'bc-F', capturedAt: at(10), ids: ['bp-F1'] },
] as const;

beforeAll(async () => {
  await serverDB.delete(users).where(inArray(users.id, [userId]));
  await serverDB.insert(users).values([{ id: userId }]);
  await serverDB.insert(userMemories).values(
    parents.map((parent) => ({
      createdAt: parent.at,
      id: parent.id,
      isDeleted: 'deleted' in parent ? parent.deleted : false,
      lastAccessedAt: parent.at,
      memoryLayer: LayersEnum.Context,
      userId,
    })),
  );
  await serverDB.insert(userMemoriesContexts).values(
    contexts.map((context) => ({
      capturedAt: context.capturedAt,
      createdAt: context.capturedAt,
      currentStatus: 'active',
      id: context.id,
      title: context.id,
      type: 'project',
      updatedAt: context.capturedAt,
      userMemoryIds: context.ids,
      userId,
    })),
  );
});

afterAll(async () => {
  await serverDB.delete(users).where(inArray(users.id, [userId]));
});

describe('LOBE-371 bounded-window equivalence probe', () => {
  it('page 2 size 2 with zero-visible-pair contexts inside the window', async () => {
    const params = { layer: LayersEnum.Context, order: 'desc' as const, page: 2, pageSize: 2 };
    const query = await model.queryMemories(params);
    const list = await model.listMemories(params);
    const pairs = (items: Array<{ context: { id: string }; memory: { id: string } }>) =>
      items.map((item) => [item.context.id, item.memory.id]);
    const result = {
      page: query.page,
      pageSize: query.pageSize,
      pairs: pairs(query.items as any),
      total: query.total,
      listPairs: pairs(list as any),
    };
    writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
    console.log('PROBE_RESULT', JSON.stringify(result));
  });
});
