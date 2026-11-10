// @vitest-environment node
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  expertiseDomains,
  expertiseHits,
  expertiseLessons,
  expertiseRuns,
  users,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { ExpertiseModel } from '../expertise';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'staleness-test-user';
const domainId = 'staleness-test-domain';

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

const createLesson = async (id: string, code: string, createdAt: Date) => {
  await serverDB.insert(expertiseLessons).values({
    code,
    createdAt,
    domainId,
    id,
    polarity: 'rule',
    sections: [],
    title: `rule ${code}`,
    updatedAt: createdAt,
  });
};

const ensureRun = async (runId: string) => {
  const existing = await serverDB
    .select({ id: expertiseRuns.id })
    .from(expertiseRuns)
    .where(eq(expertiseRuns.id, runId));
  if (existing.length > 0) return;

  const [max] = await serverDB
    .select({ value: sql<number>`coalesce(max(${expertiseRuns.runIndex}), 0)` })
    .from(expertiseRuns)
    .where(eq(expertiseRuns.domainId, domainId));

  await serverDB.insert(expertiseRuns).values({
    actorId: userId,
    actorType: 'user',
    domainId,
    id: runId,
    runIndex: Number(max.value) + 1,
    subjectId: 'staleness-subject',
    subjectType: 'topic',
    userId,
  });
};

const createHit = async (lessonId: string, runId: string, createdAt: Date) => {
  await ensureRun(runId);
  await serverDB.insert(expertiseHits).values({
    createdAt,
    domainId,
    lessonId,
    outcome: 'pass',
    runId,
    updatedAt: createdAt,
  });
};

const statusOf = async (id: string) => {
  const [row] = await serverDB
    .select({ status: expertiseLessons.status })
    .from(expertiseLessons)
    .where(eq(expertiseLessons.id, id));
  return row?.status;
};

describe('ExpertiseModel.retireStaleLessons', () => {
  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.insert(users).values({ id: userId });
    await serverDB.insert(expertiseDomains).values({
      domainFilter: 'any',
      id: domainId,
      slug: 'staleness',
      title: 'staleness',
      userId,
    });
  });

  afterEach(async () => {
    await serverDB.delete(users);
  });

  it('retires a lesson older than the age floor with no run in the window', async () => {
    await createLesson('11111111-1111-1111-1111-111111111111', 'P-01', ago(8));

    const model = new ExpertiseModel(serverDB, userId);
    const result = await model.retireStaleLessons();

    expect(result.retired.map((lesson) => lesson.code)).toEqual(['P-01']);
    expect(await statusOf('11111111-1111-1111-1111-111111111111')).toBe('retired');
  });

  it('keeps a lesson that recent practice still applies', async () => {
    await createLesson('22222222-2222-2222-2222-222222222222', 'P-02', ago(30));
    for (let run = 0; run < 4; run += 1) {
      await createHit(
        '22222222-2222-2222-2222-222222222222',
        `aaaaaaa${run}-aaaa-aaaa-aaaa-aaaaaaaaaaaa`,
        ago(2),
      );
    }

    const model = new ExpertiseModel(serverDB, userId);
    const result = await model.retireStaleLessons();

    expect(result.retired).toEqual([]);
    expect(await statusOf('22222222-2222-2222-2222-222222222222')).toBe('active');
  });

  it('counts runs, not hits, inside the window', async () => {
    await createLesson('33333333-3333-3333-3333-333333333333', 'P-03', ago(30));
    // Six hits inside one practice run: sustained use would be six runs, not this.
    for (let hit = 0; hit < 6; hit += 1) {
      await createHit(
        '33333333-3333-3333-3333-333333333333',
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        ago(2),
      );
    }

    const model = new ExpertiseModel(serverDB, userId);
    await model.retireStaleLessons();

    expect(await statusOf('33333333-3333-3333-3333-333333333333')).toBe('retired');
  });

  it('never retires a lesson created inside the age floor', async () => {
    await createLesson('44444444-4444-4444-4444-444444444444', 'P-04', ago(3));

    const model = new ExpertiseModel(serverDB, userId);
    const result = await model.retireStaleLessons();

    expect(result.retired).toEqual([]);
    expect(await statusOf('44444444-4444-4444-4444-444444444444')).toBe('active');
  });

  it('ignores runs that fell out of the window', async () => {
    await createLesson('55555555-5555-5555-5555-555555555555', 'P-05', ago(30));
    await createHit(
      '55555555-5555-5555-5555-555555555555',
      'cccccccc-cccc-cccc-cccc-cccccccccccc',
      ago(20),
    );

    const model = new ExpertiseModel(serverDB, userId);
    const result = await model.retireStaleLessons();

    expect(result.retired.map((lesson) => lesson.code)).toEqual(['P-05']);
  });

  it('leaves other users lessons alone', async () => {
    await serverDB.insert(users).values({ id: 'other-user' });
    await serverDB.insert(expertiseDomains).values({
      domainFilter: 'any',
      id: 'other-domain',
      slug: 'other',
      title: 'other',
      userId: 'other-user',
    });
    await serverDB.insert(expertiseLessons).values({
      code: 'P-01',
      createdAt: ago(30),
      domainId: 'other-domain',
      id: '66666666-6666-6666-6666-666666666666',
      polarity: 'rule',
      sections: [],
      title: 'other rule',
      updatedAt: ago(30),
    });

    const model = new ExpertiseModel(serverDB, userId);
    await model.retireStaleLessons();

    expect(await statusOf('66666666-6666-6666-6666-666666666666')).toBe('active');
  });
});
