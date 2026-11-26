// @vitest-environment node
import type { SearchMemoryParams } from '@lobechat/types';
import { LayersEnum, UserMemoryContextObjectType } from '@lobechat/types';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  userMemories,
  userMemoriesActivities,
  userMemoriesContexts,
  userMemoriesIdentities,
  userMemoriesPreferences,
  users,
} from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { UserMemoryModel } from '../model';
import type { UserMemoryQueryContext } from '../query/context';

const userId = 'memory-lexical-union-user';
const otherUserId = 'memory-lexical-union-other';
const serverDB: LobeChatDatabase = await getTestDB();

const layerLimits = (layer: LayersEnum, topK: number) => {
  const limits: SearchMemoryParams['topK'] = {
    activities: 0,
    contexts: 0,
    experiences: 0,
    identities: 0,
    preferences: 0,
  };
  if (layer === LayersEnum.Activity) limits.activities = topK;
  if (layer === LayersEnum.Context) limits.contexts = topK;
  if (layer === LayersEnum.Experience) limits.experiences = topK;
  if (layer === LayersEnum.Identity) limits.identities = topK;
  if (layer === LayersEnum.Preference) limits.preferences = topK;
  return limits;
};

const searchLayer = async (
  model: UserMemoryModel,
  layer: Exclude<LayersEnum, LayersEnum.Experience>,
  topK: number,
  query?: string,
) => {
  const params = { layers: [layer], queries: query ? [query] : [], topK: layerLimits(layer, topK) };
  const result = await model.searchMemory(params);
  return layer === LayersEnum.Context
    ? result.contexts
    : layer === LayersEnum.Activity
      ? result.activities
      : layer === LayersEnum.Identity
        ? result.identities
        : result.preferences;
};

const insertMemory = async (
  values: Partial<typeof userMemories.$inferInsert> & { userId?: string } = {},
) => {
  const ownerId = values.userId ?? userId;
  const [memory] = await serverDB
    .insert(userMemories)
    .values({
      details: 'Parent details',
      lastAccessedAt: new Date(),
      memoryLayer: 'context',
      memoryType: 'context',
      summary: 'Parent summary',
      title: 'Parent title',
      userId: ownerId,
      ...values,
    })
    .returning();
  return memory;
};

const insertContext = async (
  memoryIds: string[] | null,
  values: Partial<typeof userMemoriesContexts.$inferInsert> = {},
) => {
  const [context] = await serverDB
    .insert(userMemoriesContexts)
    .values({
      associatedObjects: [{ name: 'Atlas', type: UserMemoryContextObjectType.Application }],
      associatedSubjects: [{ name: 'Owner' }],
      capturedAt: new Date('2026-01-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      currentStatus: 'active',
      description: 'Child description',
      metadata: { complete: true },
      nextSteps: ['next'],
      openQuestions: ['question'],
      title: 'Child title',
      type: 'project',
      userId,
      userMemoryIds: memoryIds,
      ...values,
    })
    .returning();
  return context;
};

const lexicalRows = async (
  model: UserMemoryModel,
  layer: Exclude<LayersEnum, LayersEnum.Experience>,
  query: string,
  limit = 100,
) => {
  return searchLayer(model, layer, limit, query);
};

beforeEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, otherUserId));
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, otherUserId));
});

describe('UserMemoryModel.searchMemory lexical candidate union', () => {
  it('returns base-parent and child matches before hydration with complete fields', async () => {
    const parentMatch = await insertMemory({ title: 'LobeHub release' });
    const childMatch = await insertMemory({ title: 'Unrelated parent' });
    const [first] = await serverDB
      .insert(userMemoriesContexts)
      .values({
        capturedAt: new Date('2026-01-02T00:00:00.000Z'),
        description: 'LobeHub child description',
        title: 'First LobeHub context',
        userId,
        userMemoryId: parentMatch.id,
        userMemoryIds: [parentMatch.id],
      })
      .returning();
    const [second] = await serverDB
      .insert(userMemoriesContexts)
      .values({
        capturedAt: new Date('2026-01-03T00:00:00.000Z'),
        description: 'LobeHub second child',
        title: 'Second LobeHub context',
        userId,
        userMemoryId: childMatch.id,
        userMemoryIds: [childMatch.id],
      })
      .returning();

    const rows = await lexicalRows(
      new UserMemoryModel(serverDB, userId),
      LayersEnum.Context,
      'LobeHub',
    );

    expect(rows.map(({ id }) => id)).toEqual([second.id, first.id]);
    expect(rows[1]).toMatchObject({
      associatedObjects: first.associatedObjects,
      associatedSubjects: first.associatedSubjects,
      description: first.description,
      id: first.id,
      metadata: first.metadata,
      nextSteps: first.nextSteps,
      now: first.now,
      openQuestions: first.openQuestions,
      scoreImpact: first.scoreImpact,
      scoreUrgency: first.scoreUrgency,
      synthesizedAt: first.synthesizedAt,
      tags: first.tags,
      title: first.title,
      type: first.type,
      updatedAt: first.updatedAt,
      userId: first.userId,
      userMemoryId: first.userMemoryId,
      userMemoryIds: first.userMemoryIds,
    });
  });

  it('honors a live legacy list when the new parent is invalid, and rejects invalid parents', async () => {
    const liveLegacyParent = await insertMemory();
    const softDeletedLegacyParent = await insertMemory({ isDeleted: true });
    const supersededLegacyParent = await insertMemory({ state: 'superseded' });
    const rejectedLegacyParent = await insertMemory({ state: 'rejected' });
    const otherParent = await insertMemory({ userId: otherUserId });
    const invalidNewParent = await insertMemory({ state: 'rejected' });
    await serverDB
      .update(userMemories)
      .set({ title: 'Atlas visible parent' })
      .where(eq(userMemories.id, liveLegacyParent.id));

    const liveLegacy = await insertContext([liveLegacyParent.id, softDeletedLegacyParent.id], {
      description: 'No matching term',
    });
    const hiddenRows = await Promise.all([
      insertContext([softDeletedLegacyParent.id], { description: 'No matching term' }),
      insertContext([supersededLegacyParent.id], { description: 'No matching term' }),
      insertContext([rejectedLegacyParent.id], { description: 'No matching term' }),
      insertContext([otherParent.id], { description: 'No matching term' }),
      insertContext([liveLegacyParent.id], {
        description: 'No matching term',
        userMemoryId: invalidNewParent.id,
      }),
    ]);

    const model = new UserMemoryModel(serverDB, userId);
    const rows = await lexicalRows(model, LayersEnum.Context, 'atlas');

    expect(rows.map(({ id }) => id)).toEqual([liveLegacy.id]);
    await serverDB
      .update(userMemories)
      .set({ state: 'active', title: 'Atlas active parent' })
      .where(eq(userMemories.id, invalidNewParent.id));
    await serverDB
      .update(userMemoriesContexts)
      .set({ userMemoryId: invalidNewParent.id })
      .where(eq(userMemoriesContexts.id, liveLegacy.id));
    expect((await lexicalRows(model, LayersEnum.Context, 'atlas')).map(({ id }) => id)).toEqual(
      expect.arrayContaining([liveLegacy.id, hiddenRows[4].id]),
    );
    expect(new Set(rows.map(({ id }) => id))).toEqual(new Set([liveLegacy.id]));
    await serverDB
      .update(userMemories)
      .set({ isDeleted: true })
      .where(eq(userMemories.id, invalidNewParent.id));
    expect(await lexicalRows(model, LayersEnum.Context, 'atlas')).toEqual([]);
    await serverDB
      .update(userMemories)
      .set({ isDeleted: null })
      .where(eq(userMemories.id, invalidNewParent.id));
    expect(await searchLayer(model, LayersEnum.Context, 100, 'atlas')).toHaveLength(2);
    expect(
      await searchLayer(
        new UserMemoryModel(serverDB, otherUserId),
        LayersEnum.Context,
        100,
        'atlas',
      ),
    ).toEqual([]);
  });

  it('deduplicates multi-parent contexts before ordering and limiting', async () => {
    const firstParent = await insertMemory();
    const secondParent = await insertMemory();
    const thirdParent = await insertMemory();
    await serverDB
      .update(userMemories)
      .set({ title: 'Atlas shared parent' })
      .where(inArray(userMemories.id, [firstParent.id, secondParent.id, thirdParent.id]));
    const multiParent = await insertContext([firstParent.id, secondParent.id, thirdParent.id], {
      capturedAt: new Date('2026-01-03T00:00:00.000Z'),
      createdAt: new Date('2026-01-03T00:00:00.000Z'),
    });
    const newest = await insertContext([firstParent.id], {
      capturedAt: new Date('2026-01-04T00:00:00.000Z'),
      createdAt: new Date('2026-01-04T00:00:00.000Z'),
    });

    const rows = await lexicalRows(
      new UserMemoryModel(serverDB, userId),
      LayersEnum.Context,
      'atlas',
      1,
    );

    expect(rows.map(({ id }) => id)).toEqual([newest.id]);
    expect(new Set(rows.map(({ id }) => id))).toEqual(new Set([newest.id]));
    expect(rows[0].capturedAt).toEqual(newest.capturedAt);
    expect(multiParent.id).not.toBe(newest.id);
  });

  it('does not return standalone NULL and empty legacy contexts on the base-memory join path', async () => {
    const nullList = await insertContext(null, { description: 'Atlas NULL legacy list' });
    const emptyList = await insertContext([], { description: 'Atlas empty legacy list' });
    await Promise.all([
      insertContext(null, { description: 'No matching term', title: 'No matching term' }),
      insertContext([], { description: 'No matching term', title: 'No matching term' }),
    ]);

    const rows = await lexicalRows(
      new UserMemoryModel(serverDB, userId),
      LayersEnum.Context,
      'atlas',
    );

    expect(rows.map(({ id }) => id)).not.toEqual(
      expect.arrayContaining([nullList.id, emptyList.id]),
    );
  });

  it('keeps a live new parent visible even when its legacy list is empty', async () => {
    const parent = await insertMemory();
    const context = await insertContext([], {
      description: 'Atlas new parent',
      userMemoryId: parent.id,
    });

    const rows = await lexicalRows(
      new UserMemoryModel(serverDB, userId),
      LayersEnum.Context,
      'atlas',
    );

    expect(rows.map(({ id }) => id)).toEqual([context.id]);
  });

  it.each([
    [LayersEnum.Activity, userMemoriesActivities],
    [LayersEnum.Preference, userMemoriesPreferences],
    [LayersEnum.Identity, userMemoriesIdentities],
  ] as const)('returns both parent and layer BM25 matches for %s', async (layer, table) => {
    const parentMatch = await insertMemory({ title: 'LobeHub parent' });
    const childMatch = await insertMemory({ title: 'Unrelated parent' });
    const makeRow = (userMemoryId: string, text: string) => {
      if (layer === LayersEnum.Activity) {
        return {
          narrative: text,
          status: 'completed',
          type: 'task',
          userId,
          userMemoryId,
        };
      }
      if (layer === LayersEnum.Preference) {
        return { conclusionDirectives: text, type: 'coding-style', userId, userMemoryId };
      }
      return { description: text, type: 'personal', userId, userMemoryId };
    };
    const first = await serverDB
      .insert(table)
      .values([
        {
          ...makeRow(parentMatch.id, 'no matching term'),
          capturedAt: new Date('2026-01-02T00:00:00.000Z'),
        },
        {
          ...makeRow(childMatch.id, 'LobeHub child'),
          capturedAt: new Date('2026-01-03T00:00:00.000Z'),
        },
      ] as never)
      .returning();

    const rows = await lexicalRows(new UserMemoryModel(serverDB, userId), layer, 'LobeHub');

    expect(rows).toHaveLength(2);
    expect(rows.map(({ id }) => id)).toEqual([first[1].id, first[0].id]);
    expect(rows[0]).toMatchObject({ userMemoryId: childMatch.id });
    expect(rows[1]).toMatchObject({ userMemoryId: parentMatch.id });
  });

  it('preserves combined filters and the overfetch boundary on the real searchMemory path', async () => {
    const wantedParent = await insertMemory({
      capturedAt: new Date('2026-01-02T00:00:00.000Z'),
      memoryCategory: 'work',
      tags: ['atlas'],
      title: 'LobeHub wanted',
    });
    const wanted = await insertContext([wantedParent.id], {
      capturedAt: new Date('2026-01-02T00:00:00.000Z'),
      currentStatus: 'active',
      tags: ['atlas'],
      title: 'LobeHub context',
      type: 'project',
    });
    await insertContext([wantedParent.id], {
      capturedAt: new Date('2026-01-03T00:00:00.000Z'),
      currentStatus: 'archived',
      title: 'LobeHub context',
      type: 'project',
    });
    await insertContext([wantedParent.id], {
      capturedAt: new Date('2026-01-03T00:00:00.000Z'),
      currentStatus: 'active',
      tags: ['atlas'],
      title: 'LobeHub context',
      type: 'incident',
    });

    const result = await new UserMemoryModel(serverDB, userId).searchMemory({
      categories: ['work'],
      layers: [LayersEnum.Context],
      queries: ['LobeHub'],
      status: ['active'],
      tags: ['atlas'],
      timeRange: {
        end: new Date('2026-01-02T12:00:00.000Z'),
        start: new Date('2026-01-02T00:00:00.000Z'),
      },
      topK: layerLimits(LayersEnum.Context, 1),
      types: ['project'],
    });

    expect(result.contexts.map(({ id }) => id)).toEqual([wanted.id]);
    expect(result.meta.layers.contexts).toMatchObject({ returned: 1 });
  });

  it('uses generated parent and child IDs with the same table-qualified predicate', async () => {
    const memory = await insertMemory({ title: 'Atlas generated parent' });
    const context = await insertContext([memory.id], {
      description: 'Atlas generated child',
      userMemoryId: memory.id,
    });
    const queryModel = Reflect.get(new UserMemoryModel(serverDB, userId), 'queryModel') as {
      context: UserMemoryQueryContext;
      searchContextsLexical: (
        query: string,
        limit: number,
        params: object,
      ) => Promise<Array<{ id: string }>>;
    };
    const rows = (await queryModel.searchContextsLexical('Atlas', 100, {})) as Array<{
      id: string;
    }>;
    expect(rows.map(({ id }) => id)).toEqual([context.id]);
    expect(context.id).not.toBe(memory.id);
  });
});
