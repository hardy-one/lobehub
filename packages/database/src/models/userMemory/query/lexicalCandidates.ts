import type { SQL } from 'drizzle-orm';
import { and, eq, or, sql } from 'drizzle-orm';

import type {
  userMemoriesActivities,
  userMemoriesExperiences,
  userMemoriesIdentities,
  userMemoriesPreferences,
} from '../../../schemas';
import { userMemories, userMemoriesContexts } from '../../../schemas';
import { inJsonStringArray } from '../../../utils/inJsonStringArray';
import type { UserMemoryQueryContext } from './context';

type LexicalLayerTable =
  | typeof userMemoriesActivities
  | typeof userMemoriesContexts
  | typeof userMemoriesExperiences
  | typeof userMemoriesIdentities
  | typeof userMemoriesPreferences;

export const collectLexicalCandidateIds = async (
  ctx: UserMemoryQueryContext,
  table: LexicalLayerTable,
  matches: { child: SQL; parent: SQL },
): Promise<string[]> => {
  const [parentIds, childIds] = await Promise.all([
    ctx.db
      .select({ id: userMemories.id })
      .from(userMemories)
      .where(and(ctx.memoryWhere(userMemories), matches.parent)),
    table === userMemoriesContexts
      ? ctx.db
          .select({ id: userMemoriesContexts.id })
          .from(userMemoriesContexts)
          .where(
            and(
              ctx.memoryWhere(userMemoriesContexts),
              matches.child,
              or(
                sql`EXISTS (
                  SELECT 1
                  FROM jsonb_array_elements_text(${userMemoriesContexts.userMemoryIds}) AS legacy_ids(mem_id)
                  JOIN ${userMemories} ON ${userMemories.id} = legacy_ids.mem_id
                  WHERE ${userMemories.userId} = ${userMemoriesContexts.userId}
                    AND ${userMemories.isDeleted} IS NOT TRUE
                    AND (${userMemories.state} IS NULL OR ${userMemories.state} <> ALL (ARRAY['superseded', 'rejected']))
                )`,
                sql`${userMemoriesContexts.userMemoryId} IS NOT NULL`,
              ),
            ),
          )
      : ctx.db
          .select({ id: table.id })
          .from(table)
          .where(and(ctx.memoryWhere(table), matches.child)),
  ]);

  const parentIdList = parentIds.map(({ id }) => id);
  if (parentIdList.length === 0) return childIds.map(({ id }) => id);

  const linkedRows =
    table === userMemoriesContexts
      ? await ctx.db
          .select({ id: userMemoriesContexts.id })
          .from(userMemoriesContexts)
          .where(
            and(
              ctx.memoryWhere(userMemoriesContexts),
              or(
                sql`EXISTS (
                  SELECT 1
                  FROM jsonb_array_elements_text(${userMemoriesContexts.userMemoryIds}) AS legacy_ids(mem_id)
                  WHERE ${inJsonStringArray(sql`legacy_ids.mem_id`, parentIdList)}
                )`,
                and(
                  sql`${userMemoriesContexts.userMemoryId} IS NOT NULL`,
                  inJsonStringArray(userMemoriesContexts.userMemoryId, parentIdList),
                ),
              ),
            ),
          )
      : await ctx.db
          .select({ id: table.id })
          .from(table)
          .innerJoin(userMemories, eq(userMemories.id, table.userMemoryId))
          .where(
            and(
              ctx.memoryWhere(table),
              ctx.memoryWhere(userMemories),
              inJsonStringArray(userMemories.id, parentIdList),
            ),
          );

  return [...new Set([...childIds.map(({ id }) => id), ...linkedRows.map(({ id }) => id)])];
};
