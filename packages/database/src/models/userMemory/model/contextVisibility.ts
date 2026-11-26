import type { AnyColumn, SQL } from 'drizzle-orm';
import { and, asc, desc, eq, sql } from 'drizzle-orm';

import { userMemories, userMemoriesContexts } from '../../../schemas';
import { visibleMemoryState } from '../../../utils/memoryVisibility';
import { notTrashed } from '../../../utils/softDelete';
import type { UserMemoryModelContext } from './context';

interface ContextVisibilityParams {
  contextFilters?: SQL | undefined;
  ctx: UserMemoryModelContext;
  joinedFilters?: SQL | undefined;
  layer?: string;
  memoryFilters?: SQL | undefined;
  offset: number;
  order?: 'asc' | 'desc';
  pageSize: number;
  scoreColumn?: SQL | AnyColumn;
}

export const buildContextVisibilityCte = ({
  ctx,
  joinedFilters,
  layer,
  order = 'desc',
  offset,
  pageSize,
  contextFilters,
  memoryFilters,
  scoreColumn,
}: ContextVisibilityParams) => {
  const applyOrder = order === 'asc' ? asc : desc;

  const filteredPairs = ctx.db.$with('memory_filtered_pairs').as(
    ctx.db
      .select({
        contextId: sql<string>`${userMemoriesContexts.id}`.as('context_id'),
        contextCreatedAt: userMemoriesContexts.createdAt,
        contextUpdatedAt: userMemoriesContexts.updatedAt,
        memoryId: sql<string>`${userMemories.id}`.as('memory_id'),
        score: scoreColumn
          ? sql`${scoreColumn}`.as('score_column')
          : sql<null>`NULL`.as('score_column'),
      })
      .from(userMemoriesContexts)
      .innerJoin(
        userMemories,
        and(
          eq(userMemories.userId, userMemoriesContexts.userId),
          sql<boolean>`COALESCE(${userMemoriesContexts.userMemoryIds}, '[]'::jsonb) ? (${userMemories.id})::text`,
        ),
      )
      .where(
        and(
          eq(userMemoriesContexts.userId, ctx.userId),
          eq(userMemories.userId, ctx.userId),
          layer ? eq(userMemories.memoryLayer, layer) : undefined,
          notTrashed(userMemories.isDeleted),
          visibleMemoryState(userMemories.state),
          contextFilters,
          memoryFilters,
          joinedFilters,
        ),
      ),
  );

  const pagePairs = ctx.db.$with('memory_context_page').as(
    ctx.db
      .select({
        contextId: filteredPairs.contextId,
        memoryId: filteredPairs.memoryId,
        score: filteredPairs.score,
      })
      .from(filteredPairs)
      .orderBy(
        applyOrder(filteredPairs.score),
        applyOrder(filteredPairs.contextUpdatedAt),
        applyOrder(filteredPairs.contextCreatedAt),
      )
      .limit(pageSize)
      .offset(offset),
  );

  const contextBridges = ctx.db.$with('memory_context_bridges').as(
    ctx.db
      .select({
        contextId: sql<string>`${pagePairs.contextId}`.as('context_id'),
        memoryId: sql<string>`${pagePairs.memoryId}`.as('memory_id'),
        score: pagePairs.score,
      })
      .from(pagePairs),
  );

  return { applyOrder, contextBridges, filteredPairs, pagePairs };
};
