import type { DeviceExecutionTarget } from '@lobechat/types';
import { sql } from 'drizzle-orm';
import { check, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';
import { agents } from './agent';
import { topics } from './topic';
import { users } from './user';

/**
 * Private execution-target preferences for one user on one source client.
 * Agent rows provide the source-local default; topic rows override it for one
 * conversation. The two scopes are mutually exclusive.
 */
export const userExecutionTargetPreferences = pgTable(
  'user_execution_target_preferences',
  {
    id: uuid('id').defaultRandom().notNull().primaryKey(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    sourceClientId: uuid('source_client_id').notNull(),
    agentId: text('agent_id').references(() => agents.id, { onDelete: 'cascade' }),
    topicId: text('topic_id').references(() => topics.id, { onDelete: 'cascade' }),
    executionTarget: text('execution_target').$type<DeviceExecutionTarget>().notNull(),
    boundDeviceId: text('bound_device_id'),
    ...timestamps,
  },
  (t) => [
    check(
      'user_execution_target_preferences_scope_check',
      sql`(${t.agentId} IS NULL) <> (${t.topicId} IS NULL)`,
    ),
    uniqueIndex('user_execution_target_preferences_agent_scope_unique')
      .on(t.userId, t.sourceClientId, t.agentId)
      .where(sql`${t.agentId} IS NOT NULL`),
    uniqueIndex('user_execution_target_preferences_topic_scope_unique')
      .on(t.userId, t.sourceClientId, t.topicId)
      .where(sql`${t.topicId} IS NOT NULL`),
  ],
);

export type UserExecutionTargetPreferenceItem = typeof userExecutionTargetPreferences.$inferSelect;
export type NewUserExecutionTargetPreference = typeof userExecutionTargetPreferences.$inferInsert;
