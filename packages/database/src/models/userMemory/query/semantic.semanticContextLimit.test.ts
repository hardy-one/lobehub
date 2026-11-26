import { LayersEnum } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { UserMemoryModel } from '../model';
import { UserMemoryQueryModel } from './index';
import { searchContextsSemantic } from './semantic';

const userId = 'l362-regression-user';
const embedding = (phase: number) => {
  const values = Array.from({ length: 1024 }, (_, index) => Math.sin(index / 32 + phase));
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  return values.map((value) => value / norm);
};

describe('semantic context filtering before limit', () => {
  it('keeps visible category matches outside the nearest candidates', async () => {
    const db = await getTestDB();
    const model = new UserMemoryQueryModel(db, userId);
    const schema = await import('../../../schemas');

    await db.delete(schema.userMemoriesContexts);
    await db.delete(schema.userMemories);
    await db.delete(schema.users).where((await import('drizzle-orm')).eq(schema.users.id, userId));
    await db.insert(schema.users).values({ id: userId });

    const parent = async (category: string) =>
      (
        await db
          .insert(schema.userMemories)
          .values({
            details: 'details',
            lastAccessedAt: new Date(),
            memoryCategory: category,
            memoryLayer: 'context',
            memoryType: 'context',
            summary: 'summary',
            tags: ['match'],
            title: category,
            userId,
          })
          .returning()
      )[0];

    const workParent = await parent('work');
    const personalParent = await parent('personal');
    const outsideTopK = (
      await db
        .insert(schema.userMemoriesContexts)
        .values({
          capturedAt: new Date('2026-01-02T00:00:00Z'),
          createdAt: new Date('2026-01-02T00:00:00Z'),
          currentStatus: 'active',
          description: 'matching context',
          descriptionVector: embedding(1),
          tags: ['match'],
          title: 'matching',
          type: 'project',
          userId,
          userMemoryIds: [workParent.id],
        })
        .returning()
    )[0];

    await db.insert(schema.userMemoriesContexts).values({
      capturedAt: new Date('2026-01-02T00:00:00Z'),
      createdAt: new Date('2026-01-02T00:00:00Z'),
      currentStatus: 'active',
      description: 'near but wrong category',
      descriptionVector: embedding(20),
      tags: ['match'],
      title: 'near',
      type: 'project',
      userId,
      userMemoryIds: [personalParent.id],
    });

    const rows = await searchContextsSemantic(model.context, embedding(20), 1, {
      categories: ['work'],
      tags: ['match'],
      queries: ['x'.repeat(300)],
    });

    expect(rows.map((row) => row.id)).toEqual([outsideTopK.id]);
    expect(rows[0].title).toBe('matching');
    expect(new UserMemoryModel(db, userId)).toBeDefined();
    expect(LayersEnum.Context).toBeDefined();
  });
});
