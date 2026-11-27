// @vitest-environment node
import { createHash } from 'node:crypto';
import { appendFileSync, writeFileSync } from 'node:fs';

import { LayersEnum } from '@lobechat/types';
import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { getTestDB } from '../../../../core/getTestDB';
import { userMemories, userMemoriesContexts, users } from '../../../../schemas';
import type { LobeChatDatabase } from '../../../../type';
import { UserMemoryModel } from '../../model';

const userId = 'ab-dump-lobe357-user';
const otherUserId = 'ab-dump-lobe357-other';
const serverDB: LobeChatDatabase = await getTestDB();
const model = new UserMemoryModel(serverDB, userId);
const dumpPath = process.env.LOBE363_DUMP_PATH;
if (!dumpPath) throw new Error('LOBE363_DUMP_PATH is required');
writeFileSync(dumpPath, '');
const writeDump = (line: string) => {
  appendFileSync(dumpPath, line + '\n');
};
const baseTime = Date.parse('2024-01-01T00:00:00.000Z');
const createdAt = (minutes: number) => new Date(baseTime + minutes * 60_000);

const memoryFixtures = [
  { id: 'ab-p1', userId, createdAt: createdAt(1), tags: ['memorytag'] },
  { id: 'ab-p2', userId, createdAt: createdAt(2), tags: [] },
  { id: 'ab-p3', userId, createdAt: createdAt(3), tags: [] },
  { id: 'ab-p4', userId, createdAt: createdAt(4), tags: [] },
  { id: 'ab-p5', userId, createdAt: createdAt(5), tags: [] },
  { id: 'ab-p6', userId, createdAt: createdAt(6), tags: [] },
  { id: 'ab-p7', userId, createdAt: createdAt(7), tags: [] },
  { id: 'ab-p8', userId, createdAt: createdAt(8), tags: [] },
  { id: 'ab-p9', userId, createdAt: createdAt(9), isDeleted: true, tags: [] },
  { id: 'ab-p10', userId, createdAt: createdAt(10), state: 'rejected', tags: [] },
  { id: 'ab-p11', userId, createdAt: createdAt(11), state: 'superseded', tags: [] },
  { id: 'ab-foreign-parent', userId: otherUserId, createdAt: createdAt(12), tags: [] },
] as const;

const contextFixtures = [
  {
    id: 'ab-c-new',
    userId,
    userMemoryId: 'ab-p1',
    userMemoryIds: null,
    title: 'new link',
    type: 'project',
    currentStatus: 'active',
    tags: ['ctx'],
    createdAt: createdAt(101),
    updatedAt: createdAt(201),
  },
  {
    id: 'ab-c-legacy-multi',
    userId,
    userMemoryId: null,
    userMemoryIds: ['ab-p1', 'ab-p2'],
    title: 'legacy multi',
    type: 'project',
    currentStatus: 'active',
    tags: [],
    createdAt: createdAt(102),
    updatedAt: createdAt(202),
  },
  {
    id: 'ab-c-both',
    userId,
    userMemoryId: 'ab-p3',
    userMemoryIds: ['ab-p4', 'ab-p5'],
    title: 'both links',
    type: 'decision',
    currentStatus: 'blocked',
    tags: ['wanted'],
    createdAt: createdAt(103),
    updatedAt: createdAt(203),
  },
  {
    id: 'ab-c-soft',
    userId,
    userMemoryId: 'ab-p9',
    userMemoryIds: null,
    title: 'soft deleted parent',
    type: 'project',
    currentStatus: 'active',
    tags: [],
    createdAt: createdAt(104),
    updatedAt: createdAt(204),
  },
  {
    id: 'ab-c-soft-plus-live',
    userId,
    userMemoryId: null,
    userMemoryIds: ['ab-p9', 'ab-p6'],
    title: 'soft plus live',
    type: 'project',
    currentStatus: 'active',
    tags: [],
    createdAt: createdAt(105),
    updatedAt: createdAt(205),
  },
  {
    id: 'ab-c-rejected',
    userId,
    userMemoryId: 'ab-p10',
    userMemoryIds: null,
    title: 'rejected parent',
    type: 'project',
    currentStatus: 'active',
    tags: [],
    createdAt: createdAt(106),
    updatedAt: createdAt(206),
  },
  {
    id: 'ab-c-superseded',
    userId,
    userMemoryId: 'ab-p11',
    userMemoryIds: null,
    title: 'superseded parent',
    type: 'project',
    currentStatus: 'active',
    tags: [],
    createdAt: createdAt(112),
    updatedAt: createdAt(212),
  },
  {
    id: 'ab-c-foreign-parent',
    userId,
    userMemoryId: 'ab-foreign-parent',
    userMemoryIds: null,
    title: 'foreign parent',
    type: 'project',
    currentStatus: 'active',
    tags: [],
    createdAt: createdAt(107),
    updatedAt: createdAt(207),
  },
  {
    id: 'ab-c-other-user',
    userId: otherUserId,
    userMemoryId: 'ab-p1',
    userMemoryIds: null,
    title: 'other user',
    type: 'project',
    currentStatus: 'active',
    tags: [],
    createdAt: createdAt(108),
    updatedAt: createdAt(208),
  },
  {
    id: 'ab-c-noparent',
    userId,
    userMemoryId: null,
    userMemoryIds: [],
    title: 'no parent',
    type: 'project',
    currentStatus: 'active',
    tags: [],
    createdAt: createdAt(109),
    updatedAt: createdAt(209),
  },
  {
    id: 'ab-c-archived',
    userId,
    userMemoryId: 'ab-p7',
    userMemoryIds: null,
    title: 'archived context',
    type: 'project',
    currentStatus: 'archived',
    tags: [],
    createdAt: createdAt(110),
    updatedAt: createdAt(210),
  },
  {
    id: 'ab-c-type-task',
    userId,
    userMemoryId: 'ab-p8',
    userMemoryIds: null,
    title: 'task context',
    type: 'task',
    currentStatus: 'active',
    tags: [],
    createdAt: createdAt(111),
    updatedAt: createdAt(211),
  },
] as const;

const seed = async () => {
  await serverDB.delete(users).where(inArray(users.id, [userId, otherUserId]));
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(userMemories).values(
    memoryFixtures.map((fixture) => ({
      id: fixture.id,
      isDeleted: 'isDeleted' in fixture ? fixture.isDeleted : undefined,
      lastAccessedAt: fixture.createdAt,
      memoryLayer: LayersEnum.Context,
      state: 'state' in fixture ? fixture.state : undefined,
      tags: [...fixture.tags],
      userId: fixture.userId,
      createdAt: fixture.createdAt,
    })),
  );
  await serverDB.insert(userMemoriesContexts).values([...contextFixtures]);
};

beforeAll(seed);
afterAll(async () => {
  await serverDB.delete(users).where(inArray(users.id, [userId, otherUserId]));
});

const serialize = (value: unknown) =>
  JSON.stringify(value, (_key, item) => (item instanceof Date ? item.toISOString() : item), 2);

describe('LOBE-357 model A/B dump', () => {
  it('dumps queryMemories and listMemories outputs for identical inputs', async () => {
    const cases = [
      { name: 'default', params: { layer: LayersEnum.Context } },
      {
        name: 'asc-page2-size3',
        params: { layer: LayersEnum.Context, order: 'asc' as const, page: 2, pageSize: 3 },
      },
      { name: 'page0-size500', params: { layer: LayersEnum.Context, page: 0, pageSize: 500 } },
      { name: 'page999-size10', params: { layer: LayersEnum.Context, page: 999, pageSize: 10 } },
      { name: 'status-active', params: { layer: LayersEnum.Context, status: ['active'] } },
      { name: 'type-project', params: { layer: LayersEnum.Context, types: ['project'] } },
      { name: 'tag-wanted', params: { layer: LayersEnum.Context, tags: ['wanted'] } },
      { name: 'memory-tag', params: { layer: LayersEnum.Context, tags: ['memorytag'] } },
      { name: 'category-none', params: { layer: LayersEnum.Context, categories: ['none'] } },
      { name: 'time-window', params: { layer: LayersEnum.Context, sort: 'capturedAt' } },
      { name: 'all-page100', params: { layer: LayersEnum.Context, pageSize: 100 } },
    ];
    const fixtureHash = createHash('sha256')
      .update(JSON.stringify({ memoryFixtures, contextFixtures }))
      .digest('hex');
    writeDump('LOBE357_FIXTURE_HASH ' + fixtureHash);
    writeDump('LOBE357_DUMP_BEGIN');
    writeDump(
      'LOBE357_SOURCE_MARK ' +
        JSON.stringify({
          querySource: require.resolve('../queryMemories.ts'),
          listSource: require.resolve('../listMemories.ts'),
        }),
    );
    for (const testCase of cases) {
      const queryResult = await model.queryMemories(testCase.params);
      writeDump(
        `LOBE357_QUERY ${JSON.stringify({
          name: testCase.name,
          input: testCase.params,
          page: queryResult.page,
          pageSize: queryResult.pageSize,
          total: queryResult.total,
          ids: queryResult.items.map((item) => (item.context as { id: string }).id),
          pairs: queryResult.items.map((item) => [
            (item.context as { id: string }).id,
            (item.memory as { id: string }).id,
          ]),
        })}`,
      );
      writeDump(`LOBE357_QUERY_FULL ${testCase.name} ${serialize(queryResult)}`);
      const listResult = await model.listMemories(testCase.params);
      writeDump(
        `LOBE357_LIST ${JSON.stringify({
          name: testCase.name,
          input: testCase.params,
          ids: listResult.map((item) => (item.context as { id: string }).id),
          pairs: listResult.map((item) => [
            (item.context as { id: string }).id,
            (item.memory as { id: string }).id,
          ]),
        })}`,
      );
      writeDump(`LOBE357_LIST_FULL ${testCase.name} ${serialize(listResult)}`);
    }
    writeDump('LOBE357_DUMP_END');
  });
});
