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
const domainAgentId = 'retire-agent';
const domainUserId = 'retire-user-domain';
const domainYoungId = 'retire-young-domain';

const when = (n: number) => new Date(Date.now() - n * 60 * 60 * 1000);

const createTopic = async (id: string, agentId: string | null, hoursAgo: number) => {
  await serverDB.insert(topics).values({
    agentId,
    id,
    title: id,
    updatedAt: when(hoursAgo),
    userId,
  });
};

const createLesson = async (id: string, code: string, domainId: string) => {
  await serverDB.insert(expertiseLessons).values({
    code,
    createdAt: when(200),
    domainId,
    id,
    polarity: 'rule',
    sections: [],
    title: `rule ${code}`,
    updatedAt: when(200),
  });
};

const createRun = async (id: string, domainId: string, subjectId: string, subjectType: string) => {
  await serverDB.insert(expertiseRuns).values({
    actorId: userId,
    actorType: 'user',
    domainId,
    id,
    runIndex: Math.floor(Math.random() * 100_000),
    subjectId,
    subjectType: subjectType as any,
    userId,
  });
};

const createHit = async (lessonId: string, runId: string, domainId: string) => {
  await serverDB.insert(expertiseHits).values({
    createdAt: when(1),
    domainId,
    lessonId,
    outcome: 'pass',
    runId,
    updatedAt: when(1),
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
    await serverDB.insert(agents).values({ id: domainAgentId, title: 'agent', userId });

    await serverDB.insert(expertiseDomains).values([
      {
        domainFilter: 'any',
        id: domainAgentId + '-domain',
        slug: 'a',
        title: 'agent domain',
        userId,
      },
      { domainFilter: 'any', id: domainUserId, slug: 'u', title: 'user domain', userId },
      { domainFilter: 'any', id: domainYoungId, slug: 'y', title: 'young domain', userId },
    ]);

    await serverDB.insert(expertiseBindings).values([
      { agentId: domainAgentId, domainId: domainAgentId + '-domain', enabled: true },
      { boundUserId: userId, domainId: domainUserId, enabled: true },
      { boundUserId: userId, domainId: domainYoungId, enabled: true },
    ]);
  });

  afterEach(async () => {
    await serverDB.delete(users);
  });

  it('retires a lesson the window never applies and keeps one it does', async () => {
    // Four topics: window of three leaves the oldest outside.
    for (let i = 0; i < 4; i += 1) {
      await createTopic(`t-${i}`, domainAgentId, 10 - i);
    }
    await createLesson('aaaaaaaa-0000-0000-0000-000000000001', 'P-01', domainAgentId + '-domain');
    await createLesson('aaaaaaaa-0000-0000-0000-000000000002', 'P-02', domainAgentId + '-domain');

    await createRun(
      '11111111-0000-0000-0000-000000000001',
      domainAgentId + '-domain',
      't-1',
      'topic',
    );
    await createHit(
      'aaaaaaaa-0000-0000-0000-000000000001',
      '11111111-0000-0000-0000-000000000001',
      domainAgentId + '-domain',
    );

    const model = new ExpertiseModel(serverDB, userId);
    const result = await model.retireStaleLessons({ maxHits: 0, windowTopics: 3 });

    expect(result.retired.map((lesson) => lesson.code)).toEqual(['P-02']);
    expect(await statusOf('aaaaaaaa-0000-0000-0000-000000000001')).toBe('active');
    expect(await statusOf('aaaaaaaa-0000-0000-0000-000000000002')).toBe('retired');
  });

  it('ignores hits whose run points outside the window', async () => {
    for (let i = 0; i < 4; i += 1) {
      await createTopic(`t-${i}`, domainAgentId, 10 - i);
    }
    await createLesson('aaaaaaaa-0000-0000-0000-000000000003', 'P-03', domainAgentId + '-domain');

    // t-0 is the oldest of four; a three-topic window excludes it.
    await createRun(
      '11111111-0000-0000-0000-000000000002',
      domainAgentId + '-domain',
      't-0',
      'topic',
    );
    await createHit(
      'aaaaaaaa-0000-0000-0000-000000000003',
      '11111111-0000-0000-0000-000000000002',
      domainAgentId + '-domain',
    );

    const model = new ExpertiseModel(serverDB, userId);
    const result = await model.retireStaleLessons({ maxHits: 0, windowTopics: 3 });

    expect(result.retired.map((lesson) => lesson.code)).toContain('P-03');
  });

  it('does not count hits from non-topic runs', async () => {
    for (let i = 0; i < 4; i += 1) {
      await createTopic(`t-${i}`, domainAgentId, 10 - i);
    }
    await createLesson('aaaaaaaa-0000-0000-0000-000000000004', 'P-04', domainAgentId + '-domain');

    await createRun(
      '11111111-0000-0000-0000-000000000003',
      domainAgentId + '-domain',
      't-1',
      'task',
    );
    await createHit(
      'aaaaaaaa-0000-0000-0000-000000000004',
      '11111111-0000-0000-0000-000000000003',
      domainAgentId + '-domain',
    );

    const model = new ExpertiseModel(serverDB, userId);
    const result = await model.retireStaleLessons({ maxHits: 0, windowTopics: 3 });

    expect(result.retired.map((lesson) => lesson.code)).toContain('P-04');
  });

  it('skips a domain whose agents have not produced a full window', async () => {
    await createTopic('t-young', domainAgentId, 5);
    await createLesson('aaaaaaaa-0000-0000-0000-000000000005', 'P-05', domainYoungId);

    const model = new ExpertiseModel(serverDB, userId);
    const result = await model.retireStaleLessons({ maxHits: 0, windowTopics: 3 });

    expect(result.skipped.map((domain) => domain.reason)).toContain('young');
    expect(await statusOf('aaaaaaaa-0000-0000-0000-000000000005')).toBe('active');
  });

  it('draws a user-bound domain window from every topic the user owns', async () => {
    await serverDB.insert(agents).values({ id: 'second-agent', title: 'second', userId });
    // The lesson is applied in a topic from an agent that does not bind the domain.
    for (let i = 0; i < 3; i += 1) {
      await createTopic(`u-${i}`, 'second-agent', 10 - i);
    }
    await createLesson('aaaaaaaa-0000-0000-0000-000000000006', 'P-06', domainUserId);

    await createRun('11111111-0000-0000-0000-000000000004', domainUserId, 'u-0', 'topic');
    await createHit(
      'aaaaaaaa-0000-0000-0000-000000000006',
      '11111111-0000-0000-0000-000000000004',
      domainUserId,
    );

    const model = new ExpertiseModel(serverDB, userId);
    const result = await model.retireStaleLessons({ maxHits: 0, windowTopics: 3 });

    expect(result.retired.map((lesson) => lesson.code)).not.toContain('P-06');
    expect(await statusOf('aaaaaaaa-0000-0000-0000-000000000006')).toBe('active');
  });
});
