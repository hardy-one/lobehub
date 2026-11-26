import type { AnyColumn, SQL } from 'drizzle-orm';
import { and, asc, desc, eq, sql } from 'drizzle-orm';

import { userMemories, userMemoriesContexts } from '../../../schemas';
import { visibleMemoryState } from '../../../utils/memoryVisibility';
import { notTrashed } from '../../../utils/softDelete';
import type { UserMemoryModelContext } from './context';

interface ContextVisibilityParams {
  contextFilters?: SQL | undefined;
  ctx: UserMemoryModelContext;
  joinedTagFilters?: SQL | undefined;
  layer?: string;
  memoryFilters?: SQL | undefined;
  offset: number;
  order?: 'asc' | 'desc';
  pageSize: number;
  scoreColumn?: SQL | AnyColumn;
}

/**
 * Builds a bounded pair page: a limited candidate window is expanded to visible
 * parent pairs, then the pair page is selected with LIMIT/OFFSET. The parent
 * lookup never runs against the full context table.
 */
export const buildContextVisibilityCte = ({
  ctx,
  joinedTagFilters,
  layer,
  order = 'desc',
  offset,
  pageSize,
  contextFilters,
  memoryFilters,
  scoreColumn,
}: ContextVisibilityParams) => {
  const applyOrder = order === 'asc' ? asc : desc;

  const candidateWindow = ctx.db.$with('memory_candidate_window').as(
    ctx.db
      .select({
        createdAt: userMemoriesContexts.createdAt,
        id: userMemoriesContexts.id,
        score: scoreColumn
          ? sql`${scoreColumn}`.as('score_column')
          : sql<null>`NULL`.as('score_column'),
        updatedAt: userMemoriesContexts.updatedAt,
        userMemoryIds: userMemoriesContexts.userMemoryIds,
      })
      .from(userMemoriesContexts)
      .where(and(eq(userMemoriesContexts.userId, ctx.userId), contextFilters))
      .orderBy(
        ...(scoreColumn ? [applyOrder(scoreColumn)] : []),
        applyOrder(userMemoriesContexts.updatedAt),
        applyOrder(userMemoriesContexts.createdAt),
        asc(userMemoriesContexts.id),
      )
      .limit(
        sql<number>`greatest(${pageSize} * (${offset}::int / ${pageSize}::int + 1), ${pageSize})`,
      ),
  );

  const visiblePairs = ctx.db.$with('memory_visible_pairs').as(
    ctx.db
      .select({
        contextId: sql<string>`${candidateWindow.id}`.as('context_id'),
        contextCreatedAt: candidateWindow.createdAt,
        contextUpdatedAt: candidateWindow.updatedAt,
        memoryId: sql<string>`${userMemories.id}`.as('memory_id'),
        score: candidateWindow.score,
      })
      .from(candidateWindow)
      .innerJoin(userMemoriesContexts, eq(userMemoriesContexts.id, candidateWindow.id))
      .innerJoin(
        userMemories,
        and(
          eq(userMemories.userId, ctx.userId),
          layer ? eq(userMemories.memoryLayer, layer) : undefined,
          notTrashed(userMemories.isDeleted),
          visibleMemoryState(userMemories.state),
          memoryFilters,
          sql<boolean>`COALESCE(${candidateWindow.userMemoryIds}, '[]'::jsonb) ? (${userMemories.id})::text`,
        ),
      )
      .where(joinedTagFilters),
  );

  const pagePairs = ctx.db.$with('memory_context_page').as(
    ctx.db
      .select({
        contextId: sql<string>`${visiblePairs.contextId}`.as('context_id'),
        memoryId: sql<string>`${visiblePairs.memoryId}`.as('memory_id'),
        score: visiblePairs.score,
      })
      .from(visiblePairs)
      .orderBy(
        applyOrder(visiblePairs.score),
        applyOrder(visiblePairs.contextUpdatedAt),
        applyOrder(visiblePairs.contextCreatedAt),
        asc(visiblePairs.contextId),
        asc(visiblePairs.memoryId),
      )
      .limit(pageSize)
      .offset(offset),
  );

  return {
    applyOrder,
    candidateWindow,
    contextBridges: pagePairs,
    pagePairs,
    visiblePairs,
  };
};
