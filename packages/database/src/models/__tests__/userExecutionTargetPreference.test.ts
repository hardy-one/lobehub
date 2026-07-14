// @vitest-environment node
import { and, eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, topics, userExecutionTargetPreferences, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { UserExecutionTargetPreferenceModel } from '../userExecutionTargetPreference';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'execution-target-preference-user';
const otherUserId = 'execution-target-preference-other-user';
const agentId = 'execution-target-preference-agent';
const topicId = 'execution-target-preference-topic';
const sourceClientId = '11111111-1111-4111-8111-111111111111';
const otherSourceClientId = '22222222-2222-4222-8222-222222222222';

const cleanup = async () => {
  await serverDB.delete(users).where(inArray(users.id, [userId, otherUserId]));
};

beforeEach(async () => {
  await cleanup();
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(agents).values({ id: agentId, userId });
  await serverDB.insert(topics).values({ agentId, id: topicId, userId });
});

afterEach(cleanup);

describe('UserExecutionTargetPreferenceModel', () => {
  it('returns empty agent and topic preferences before either scope is saved', async () => {
    const model = new UserExecutionTargetPreferenceModel(serverDB, userId, sourceClientId);

    await expect(model.get({ agentId, topicId })).resolves.toEqual({ agent: null, topic: null });
  });

  it('stores agent and topic preferences independently and reads both at once', async () => {
    const model = new UserExecutionTargetPreferenceModel(serverDB, userId, sourceClientId);

    await model.upsert({ agentId, selection: { executionTarget: 'sandbox' } });
    await model.upsert({
      agentId,
      selection: { boundDeviceId: 'topic-device', executionTarget: 'device' },
      topicId,
    });

    await expect(model.get({ agentId, topicId })).resolves.toEqual({
      agent: { executionTarget: 'sandbox' },
      topic: { boundDeviceId: 'topic-device', executionTarget: 'device' },
    });
  });

  it('updates an existing scope and clears stale device bindings for non-device targets', async () => {
    const model = new UserExecutionTargetPreferenceModel(serverDB, userId, sourceClientId);

    await model.upsert({
      agentId,
      selection: { boundDeviceId: 'old-device', executionTarget: 'device' },
    });
    const updated = await model.upsert({ agentId, selection: { executionTarget: 'none' } });

    expect(updated.boundDeviceId).toBeNull();
    await expect(model.get({ agentId })).resolves.toEqual({
      agent: { executionTarget: 'none' },
      topic: null,
    });
    const rows = await serverDB
      .select()
      .from(userExecutionTargetPreferences)
      .where(eq(userExecutionTargetPreferences.userId, userId));
    expect(rows).toHaveLength(1);
  });

  it('rejects device-backed targets without a bound device', async () => {
    const model = new UserExecutionTargetPreferenceModel(serverDB, userId, sourceClientId);

    await expect(
      model.upsert({ agentId, selection: { executionTarget: 'local' } }),
    ).rejects.toThrow('local execution target requires a device');
  });

  it('isolates preferences by user and source client', async () => {
    const model = new UserExecutionTargetPreferenceModel(serverDB, userId, sourceClientId);
    const otherSourceModel = new UserExecutionTargetPreferenceModel(
      serverDB,
      userId,
      otherSourceClientId,
    );
    const otherUserModel = new UserExecutionTargetPreferenceModel(
      serverDB,
      otherUserId,
      sourceClientId,
    );

    await model.upsert({ agentId, selection: { executionTarget: 'sandbox' } });
    await otherSourceModel.upsert({ agentId, selection: { executionTarget: 'none' } });
    await otherUserModel.upsert({ agentId, selection: { executionTarget: 'auto' } });

    await expect(model.get({ agentId })).resolves.toMatchObject({
      agent: { executionTarget: 'sandbox' },
    });
    await expect(otherSourceModel.get({ agentId })).resolves.toMatchObject({
      agent: { executionTarget: 'none' },
    });
    await expect(otherUserModel.get({ agentId })).resolves.toMatchObject({
      agent: { executionTarget: 'auto' },
    });

    await model.delete({ agentId });
    await expect(otherSourceModel.get({ agentId })).resolves.toMatchObject({
      agent: { executionTarget: 'none' },
    });
    await expect(otherUserModel.get({ agentId })).resolves.toMatchObject({
      agent: { executionTarget: 'auto' },
    });
  });

  it('deletes only the requested agent or topic scope', async () => {
    const model = new UserExecutionTargetPreferenceModel(serverDB, userId, sourceClientId);
    await model.upsert({ agentId, selection: { executionTarget: 'sandbox' } });
    await model.upsert({ agentId, selection: { executionTarget: 'none' }, topicId });

    await model.delete({ agentId, topicId });

    await expect(model.get({ agentId, topicId })).resolves.toEqual({
      agent: { executionTarget: 'sandbox' },
      topic: null,
    });
  });

  it('enforces exactly one preference scope at the database level', async () => {
    await expect(
      serverDB.insert(userExecutionTargetPreferences).values({
        executionTarget: 'none',
        sourceClientId,
        userId,
      }),
    ).rejects.toThrow();

    await expect(
      serverDB.insert(userExecutionTargetPreferences).values({
        agentId,
        executionTarget: 'none',
        sourceClientId,
        topicId,
        userId,
      }),
    ).rejects.toThrow();
  });

  it('cascades topic, agent, and user deletions to their private preferences', async () => {
    const model = new UserExecutionTargetPreferenceModel(serverDB, userId, sourceClientId);
    await model.upsert({ agentId, selection: { executionTarget: 'sandbox' } });
    await model.upsert({ agentId, selection: { executionTarget: 'none' }, topicId });

    await serverDB.delete(topics).where(eq(topics.id, topicId));
    expect(
      await serverDB
        .select()
        .from(userExecutionTargetPreferences)
        .where(eq(userExecutionTargetPreferences.userId, userId)),
    ).toHaveLength(1);

    await serverDB.delete(agents).where(eq(agents.id, agentId));
    expect(
      await serverDB
        .select()
        .from(userExecutionTargetPreferences)
        .where(eq(userExecutionTargetPreferences.userId, userId)),
    ).toHaveLength(0);

    await serverDB.insert(agents).values({ id: agentId, userId });
    await model.upsert({ agentId, selection: { executionTarget: 'none' } });
    await serverDB.delete(users).where(eq(users.id, userId));
    expect(
      await serverDB
        .select()
        .from(userExecutionTargetPreferences)
        .where(
          and(
            eq(userExecutionTargetPreferences.userId, userId),
            eq(userExecutionTargetPreferences.sourceClientId, sourceClientId),
          ),
        ),
    ).toHaveLength(0);
  });
});
