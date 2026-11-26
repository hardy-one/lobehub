// @vitest-environment node
// LOBE-371: adversarial cross-contract A/B against the next baseline.
import { createHash } from 'node:crypto';
import { appendFileSync, writeFileSync } from 'node:fs';

import { LayersEnum } from '@lobechat/types';
import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../../core/getTestDB';
import { userMemories, userMemoriesContexts, users } from '../../../../schemas';
import type { LobeChatDatabase } from '../../../../type';
import { UserMemoryModel } from '../../model';

const userId = 'lobe371-matrix-user';
const otherUserId = 'lobe371-matrix-other';
const serverDB: LobeChatDatabase = await getTestDB();
const model = new UserMemoryModel(serverDB, userId);
const out = process.env.LOBE371_MATRIX_OUT;
if (!out) throw new Error('LOBE371_MATRIX_OUT required');
writeFileSync(out, '');
const baseTime = Date.parse('2024-01-01T00:00:00.000Z');
const at = (minutes: number) => new Date(baseTime + minutes * 60_000);

const parents = [
  { id: 'm-A1', at: at(1), tags: ['ptag'] },
  { id: 'm-A2', at: at(2), tags: [] },
  { id: 'm-S1', at: at(3), isDeleted: true, tags: [] },
  { id: 'm-S2', at: at(4), state: 'superseded', tags: [] },
  { id: 'm-S3', at: at(5), state: 'rejected', tags: [] },
  { id: 'm-E1', at: at(6), tags: [] },
  { id: 'm-F1', at: at(7), tags: [] },
  { id: 'm-G1', at: at(8), tags: [] },
  { id: 'm-H1', at: at(9), tags: [] },
  { id: 'm-other', at: at(10), tags: [] },
] as const;

const contexts = [
  { id: 'c-A', capturedAt: at(60), ids: ['m-A1', 'm-A2'], tags: ['ctx'] },
  { id: 'c-B', capturedAt: at(50), ids: ['m-S1'], tags: [] },
  { id: 'c-C', capturedAt: at(40), ids: ['m-S2'], tags: [] },
  { id: 'c-D', capturedAt: at(30), ids: ['m-S3'], tags: [] },
  { id: 'c-E', capturedAt: at(20), ids: ['m-E1'], tags: [] },
  { id: 'c-F', capturedAt: at(10), ids: ['m-F1'], tags: [] },
  { id: 'c-G', capturedAt: at(5), ids: ['m-G1'], tags: [] },
  { id: 'c-H', capturedAt: at(1), ids: ['m-H1'], tags: [] },
] as const;

beforeAll(async () => {
  await serverDB.delete(users).where(inArray(users.id, [userId, otherUserId]));
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(userMemories).values([
    ...parents
      .filter((parent) => parent.id !== 'm-other')
      .map((parent) => ({
        createdAt: parent.at,
        id: parent.id,
        isDeleted: 'isDeleted' in parent ? parent.isDeleted : false,
        lastAccessedAt: parent.at,
        memoryLayer: LayersEnum.Context,
        state: 'state' in parent ? parent.state : null,
        tags: [...parent.tags],
        userId,
      })),
    {
      createdAt: at(99),
      id: 'm-other',
      lastAccessedAt: at(99),
      memoryLayer: LayersEnum.Context,
      tags: [],
      userId: otherUserId,
    },
  ]);
  await serverDB.insert(userMemoriesContexts).values(
    contexts.map((context) => ({
      capturedAt: context.capturedAt,
      createdAt: context.capturedAt,
      currentStatus: 'active',
      id: context.id,
      tags: [...context.tags],
      title: context.id,
      type: 'project',
      updatedAt: context.capturedAt,
      userMemoryIds: context.ids,
      userId,
    })),
  );
});

afterAll(async () => {
  await serverDB.delete(users).where(inArray(users.id, [userId, otherUserId]));
});

describe('LOBE-371 adversarial cross-contract A/B', () => {
  it('pages 1..4 stay identical across filters and methods', async () => {
    const outputs: string[] = [];
    const print = (line: string) => {
      outputs.push(line);
      appendFileSync(out, line + '\n');
    };
    const cases = [
      { name: 'default', params: {} },
      { name: 'asc', params: { order: 'asc' as const } },
      { name: 'tag-ctx', params: { tags: ['ctx'] } },
      { name: 'tag-ptag', params: { tags: ['ptag'] } },
      { name: 'category-none', params: { categories: ['none'] } },
      { name: 'sort-impact', params: { sort: 'scoreImpact' as const } },
      { name: 'status-active', params: { status: ['active'] } },
      { name: 'type-project', params: { types: ['project'] } },
    ];
    for (const testCase of cases) {
      for (const page of [1, 2, 3, 4]) {
        const params = { layer: LayersEnum.Context, page, pageSize: 2, ...testCase.params };
        const query = await model.queryMemories(params);
        const list = await model.listMemories(params);
        const summary = {
          case: testCase.name,
          method: 'queryMemories',
          page,
          pageSize: 2,
          params: testCase.params,
          total: query.total,
          pairs: query.items.map((item) => [
            (item.context as { id: string }).id,
            (item.memory as { id: string }).id,
          ]),
        };
        print('MATRIX_QUERY ' + JSON.stringify(summary));
        print(
          'MATRIX_LIST ' +
            JSON.stringify({
              ...summary,
              method: 'listMemories',
              pairs: list.map((item) => [
                (item.context as { id: string }).id,
                (item.memory as { id: string }).id,
              ]),
            }),
        );
      }
    }
    const hash = createHash('sha256').update(outputs.join('\n')).digest('hex');
    print('MATRIX_HASH ' + hash);
    expect(outputs.length).toBe(65);
  });
});
