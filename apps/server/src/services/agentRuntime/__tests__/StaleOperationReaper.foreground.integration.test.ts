// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { agentOperations, topics, users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import type { AgentRuntimeCoordinator } from '@/server/modules/AgentRuntime/AgentRuntimeCoordinator';

import { StaleOperationReaper } from '../StaleOperationReaper';

const db: LobeChatDatabase = await getTestDB();
const LEASE_WINDOW_MS = 60 * 60_000;
const STALE_AFTER_MS = 5 * 60_000;

interface FixtureIds {
  operationIds: string[];
  topicId: string;
  userId: string;
}

const createFixture = async (updatedAt: Date[]): Promise<FixtureIds> => {
  const userId = `stale-reaper-user-${randomUUID()}`;
  const topicId = `stale-reaper-topic-${randomUUID()}`;
  const operationIds = updatedAt.map(() => `stale-reaper-operation-${randomUUID()}`);

  await db.insert(users).values({ id: userId });
  await db.insert(topics).values({ id: topicId, status: 'running', userId });
  await db.insert(agentOperations).values(
    operationIds.map((id, index) => ({
      id,
      provider: 'openai',
      status: 'running' as const,
      topicId,
      updatedAt: updatedAt[index],
      userId,
    })),
  );

  return { operationIds, topicId, userId };
};

const cleanupFixture = async ({ userId, topicId }: FixtureIds) => {
  await db.delete(agentOperations).where(eq(agentOperations.userId, userId));
  await db.delete(topics).where(eq(topics.id, topicId));
  await db.delete(users).where(eq(users.id, userId));
};

const createCoordinator = (): AgentRuntimeCoordinator =>
  ({
    getExecutionHistory: vi.fn().mockResolvedValue([]),
    isInterrupted: vi.fn().mockResolvedValue(false),
    loadAgentState: vi.fn().mockResolvedValue(null),
  }) as unknown as AgentRuntimeCoordinator;

describe('StaleOperationReaper foreground lease patrol', () => {
  let fixture: FixtureIds;

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (fixture) await cleanupFixture(fixture);
  });

  it('does not report an overlap when one running row is outside the lease window', async () => {
    const now = Date.now();
    fixture = await createFixture([
      new Date(now - LEASE_WINDOW_MS - 1),
      new Date(now - 10 * 60_000),
    ]);

    const result = await new StaleOperationReaper(db, {
      coordinator: createCoordinator(),
      queueService: null,
    }).sweep({ heteroSilenceMs: LEASE_WINDOW_MS, staleAfterMs: STALE_AFTER_MS });

    expect(result.concurrentForegroundTopics).toBe(0);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('reports an overlap when all foreground rows have a fresh lease', async () => {
    const now = Date.now();
    fixture = await createFixture([
      new Date(now - 10 * 60_000),
      new Date(now - 20 * 60_000),
    ]);

    const result = await new StaleOperationReaper(db, {
      coordinator: createCoordinator(),
      queueService: null,
    }).sweep({ heteroSilenceMs: LEASE_WINDOW_MS, staleAfterMs: STALE_AFTER_MS });

    expect(result.concurrentForegroundTopics).toBe(1);
    expect(console.warn).toHaveBeenCalledWith(
      '[StaleOperationReaper] concurrent foreground operations on one topic',
      expect.objectContaining({
        topicId: fixture.topicId,
        operationIds: fixture.operationIds,
        unstoppedOperationIds: [fixture.operationIds[0]],
      }),
    );
  });
});
