import type { ExecutionTargetSelection } from '@lobechat/types';
import { and, eq, isNotNull, or } from 'drizzle-orm';

import { userExecutionTargetPreferences } from '../schemas';
import type { LobeChatDatabase } from '../type';

export interface ExecutionTargetPreferenceScope {
  agentId: string;
  topicId?: string;
}

export interface ExecutionTargetPreferences {
  agent: ExecutionTargetSelection | null;
  topic: ExecutionTargetSelection | null;
}

export interface UpsertExecutionTargetPreferenceParams extends ExecutionTargetPreferenceScope {
  selection: ExecutionTargetSelection;
}

const toSelection = (row: {
  boundDeviceId: string | null;
  executionTarget: ExecutionTargetSelection['executionTarget'];
}): ExecutionTargetSelection => ({
  ...(row.boundDeviceId ? { boundDeviceId: row.boundDeviceId } : {}),
  executionTarget: row.executionTarget,
});

const normalizeBoundDeviceId = ({ boundDeviceId, executionTarget }: ExecutionTargetSelection) => {
  if (executionTarget !== 'device' && executionTarget !== 'local') return null;
  if (!boundDeviceId) throw new Error(`${executionTarget} execution target requires a device`);
  return boundDeviceId;
};

/** User- and source-client-scoped execution-target preference persistence. */
export class UserExecutionTargetPreferenceModel {
  private readonly db: LobeChatDatabase;
  private readonly sourceClientId: string;
  private readonly userId: string;

  constructor(db: LobeChatDatabase, userId: string, sourceClientId: string) {
    this.db = db;
    this.userId = userId;
    this.sourceClientId = sourceClientId;
  }

  get = async ({ agentId, topicId }: ExecutionTargetPreferenceScope) => {
    const isTopicScope = topicId !== undefined;
    const targetWhere = isTopicScope
      ? or(
          eq(userExecutionTargetPreferences.agentId, agentId),
          eq(userExecutionTargetPreferences.topicId, topicId),
        )
      : eq(userExecutionTargetPreferences.agentId, agentId);

    const rows = await this.db
      .select({
        agentId: userExecutionTargetPreferences.agentId,
        boundDeviceId: userExecutionTargetPreferences.boundDeviceId,
        executionTarget: userExecutionTargetPreferences.executionTarget,
        topicId: userExecutionTargetPreferences.topicId,
      })
      .from(userExecutionTargetPreferences)
      .where(
        and(
          eq(userExecutionTargetPreferences.userId, this.userId),
          eq(userExecutionTargetPreferences.sourceClientId, this.sourceClientId),
          targetWhere,
        ),
      );

    const result: ExecutionTargetPreferences = { agent: null, topic: null };
    for (const row of rows) {
      if (row.agentId === agentId) result.agent = toSelection(row);
      if (isTopicScope && row.topicId === topicId) result.topic = toSelection(row);
    }
    return result;
  };

  upsert = async ({ agentId, selection, topicId }: UpsertExecutionTargetPreferenceParams) => {
    const isTopicScope = topicId !== undefined;
    const now = new Date();
    const values = {
      agentId: isTopicScope ? null : agentId,
      boundDeviceId: normalizeBoundDeviceId(selection),
      executionTarget: selection.executionTarget,
      sourceClientId: this.sourceClientId,
      topicId: topicId ?? null,
      userId: this.userId,
    };
    const set = {
      boundDeviceId: values.boundDeviceId,
      executionTarget: values.executionTarget,
      accessedAt: now,
      updatedAt: now,
    };
    const insert = this.db.insert(userExecutionTargetPreferences).values(values);
    const [row] = isTopicScope
      ? await insert
          .onConflictDoUpdate({
            set,
            target: [
              userExecutionTargetPreferences.userId,
              userExecutionTargetPreferences.sourceClientId,
              userExecutionTargetPreferences.topicId,
            ],
            targetWhere: isNotNull(userExecutionTargetPreferences.topicId),
          })
          .returning()
      : await insert
          .onConflictDoUpdate({
            set,
            target: [
              userExecutionTargetPreferences.userId,
              userExecutionTargetPreferences.sourceClientId,
              userExecutionTargetPreferences.agentId,
            ],
            targetWhere: isNotNull(userExecutionTargetPreferences.agentId),
          })
          .returning();

    return row;
  };

  delete = async ({ agentId, topicId }: ExecutionTargetPreferenceScope) => {
    const targetWhere =
      topicId !== undefined
        ? eq(userExecutionTargetPreferences.topicId, topicId)
        : eq(userExecutionTargetPreferences.agentId, agentId);

    return this.db
      .delete(userExecutionTargetPreferences)
      .where(
        and(
          eq(userExecutionTargetPreferences.userId, this.userId),
          eq(userExecutionTargetPreferences.sourceClientId, this.sourceClientId),
          targetWhere,
        ),
      );
  };
}
