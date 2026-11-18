// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agents,
  expertiseBindings,
  expertiseDomains,
  expertiseHits,
  expertiseLessons,
  expertiseRuns,
  topics,
  users,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { ExpertiseModel } from '../expertise';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'retire-test-user';
const agentId = 'retire-agent';
const agentDomainId = 'retire-agent-domain';
const userDomainId = 'retire-user-domain';

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

const createTopic = async (id: string, agent: string | null, daysAgo: number) => {
  await serverDB.insert(topics).values({
    agentId: agent,
    id,
    title: id,
    updatedAt: ago(daysAgo),
    userId,
  });
};

const createLesson = async (id: string, code: string, domainId: string, daysAgo: number) => {
  await serverDB.insert(expertiseLessons).values({
    code,
    createdAt: ago(daysAgo),
    domainId,
    id,
    polarity: 'rule',
    sections: [],
    title: `rule ${code}`,
    updatedAt: ago(daysAgo),
  });
};

const createRun = async (id: string, domainId: string, subjectId: string, subjectType: string) => {
  await serverDB.insert(expertiseRuns).values({
    actorId: userId,
    actorType: 'user',
    domainId,
    id,
    runIndex: Math.floor(Math.random() * 1_000_000),
    subjectId,
    subjectType: subjectType as any,
    userId,
  });
};

const createHit = async (lessonId: string, runId: string, domainId: string) => {
  await serverDB.insert(expertiseHits).values({
    createdAt: ago(1),
    domainId,
    lessonId,
    outcome: 'pass',
    runId,
    updatedAt: ago(1),
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
    await serverDB.insert(agents).values({ id: agentId, title: 'agent', userId });

    await serverDB.insert(expertiseDomains).values([
      { domainFilter: 'any', id: agentDomainId, slug: 'a', title: 'agent domain', userId },
      { domainFilter: 'any', id: userDomainId, slug: 'u', title: 'user domain', userId },
    ]);

    await serverDB.insert(expertiseBindings).values([
      { agentId, domainId: agentDomainId, enabled: true },
      { boundUserId: userId, domainId: userDomainId, enabled: true },
    ]);

    // Five topics, the oldest outside a four-topic window.
    for (let i = 0; i < 4; i += 1) {
      await createTopic(`t-${i}`, agentId, 1 + i * 0.3);
    }
    await createTopic('t-old', agentId, 5);
  });

  afterEach(async () => {
    await serverDB.delete(users);
  });

  it('retires an old lesson the window never applies', async () => {
    await createLesson('aaaaaaaa-0000-0000-0000-000000000001', 'P-01', agentDomainId, 10);

    const model = new ExpertiseModel(serverDB, userId);
    const result = await model.retireStaleLessons({ maxHits: 0, windowTopics: 4 });

    expect(result.retired.map((lesson) => lesson.code)).toEqual(['P-01']);
    expect(await statusOf('aaaaaaaa-0000-0000-0000-000000000001')).toBe('retired');
  });

  it('never retires a lesson written after the window began', async () => {
    // The window's oldest topic is about 1.9 days back; this lesson is newer.
    await createLesson('aaaaaaaa-0000-0000-0000-000000000002', 'P-02', agentDomainId, 1);

    const model = new ExpertiseModel(serverDB, userId);
    const result = await model.retireStaleLessons({ maxHits: 0, windowTopics: 4 });

    expect(result.retired).toEqual([]);
    expect(await statusOf('aaaaaaaa-0000-0000-0000-000000000002')).toBe('active');
  });

  it('keeps a lesson the window applies', async () => {
    await createLesson('aaaaaaaa-0000-0000-0000-000000000003', 'P-03', agentDomainId, 10);
    await createRun('11111111-0000-0000-0000-000000000001', agentDomainId, 't-1', 'topic');
    await createHit(
      'aaaaaaaa-0000-0000-0000-000000000003',
      '11111111-0000-0000-0000-000000000001',
      agentDomainId,
    );

    const model = new ExpertiseModel(serverDB, userId);
    const result = await model.retireStaleLessons({ maxHits: 0, windowTopics: 4 });

    expect(result.retired).toEqual([]);
    expect(await statusOf('aaaaaaaa-0000-0000-0000-000000000003')).toBe('active');
  });

  it('ignores hits whose run points outside the window', async () => {
    await createLesson('aaaaaaaa-0000-0000-0000-000000000004', 'P-04', agentDomainId, 10);
    // t-old is the fifth-newest topic, outside a four-topic window.
    await createRun('11111111-0000-0000-0000-000000000002', agentDomainId, 't-old', 'topic');
    await createHit(
      'aaaaaaaa-0000-0000-0000-000000000004',
      '11111111-0000-0000-0000-000000000002',
      agentDomainId,
    );

    const model = new ExpertiseModel(serverDB, userId);
    const result = await model.retireStaleLessons({ maxHits: 0, windowTopics: 4 });

    expect(result.retired.map((lesson) => lesson.code)).toContain('P-04');
  });

  it('does not count hits from non-topic runs', async () => {
    await createLesson('aaaaaaaa-0000-0000-0000-000000000005', 'P-05', agentDomainId, 10);
    await createRun('11111111-0000-0000-0000-000000000003', agentDomainId, 't-1', 'task');
    await createHit(
      'aaaaaaaa-0000-0000-0000-000000000005',
      '11111111-0000-0000-0000-000000000003',
      agentDomainId,
    );

    const model = new ExpertiseModel(serverDB, userId);
    const result = await model.retireStaleLessons({ maxHits: 0, windowTopics: 4 });

    expect(result.retired.map((lesson) => lesson.code)).toContain('P-05');
  });

  it('skips a domain that has not produced a full window', async () => {
    await createLesson('aaaaaaaa-0000-0000-0000-000000000006', 'P-06', userDomainId, 10);

    const model = new ExpertiseModel(serverDB, userId);
    const result = await model.retireStaleLessons({ maxHits: 0, windowTopics: 10 });

    expect(result.skipped.some((domain) => domain.reason === 'young')).toBe(true);
    expect(await statusOf('aaaaaaaa-0000-0000-0000-000000000006')).toBe('active');
  });

  it('draws a user-bound domain window from every topic the user owns', async () => {
    await serverDB.insert(agents).values({ id: 'second-agent', title: 'second', userId });
    await createTopic('u-0', 'second-agent', 1.1);

    await createLesson('aaaaaaaa-0000-0000-0000-000000000007', 'P-07', userDomainId, 10);
    await createRun('11111111-0000-0000-0000-000000000004', userDomainId, 'u-0', 'topic');
    await createHit(
      'aaaaaaaa-0000-0000-0000-000000000007',
      '11111111-0000-0000-0000-000000000004',
      userDomainId,
    );

    const model = new ExpertiseModel(serverDB, userId);
    const result = await model.retireStaleLessons({ maxHits: 0, windowTopics: 4 });

    expect(result.retired.map((lesson) => lesson.code)).not.toContain('P-07');
  });

  it('reports candidates without writing when asked to dry run', async () => {
    await createLesson('aaaaaaaa-0000-0000-0000-000000000008', 'P-08', agentDomainId, 10);

    const model = new ExpertiseModel(serverDB, userId);
    const result = await model.retireStaleLessons({ dryRun: true, maxHits: 0, windowTopics: 4 });

    expect(result.retired.map((lesson) => lesson.code)).toContain('P-08');
    expect(await statusOf('aaaaaaaa-0000-0000-0000-000000000008')).toBe('active');
  });
});
