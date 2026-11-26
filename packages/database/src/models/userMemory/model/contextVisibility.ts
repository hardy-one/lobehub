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
 * Builds a bounded source of visible pairs: every context is joined to its
 * visible parents before the LIMIT, so a context with no visible parent cannot
 * consume a window slot. The LIMIT covers only the pairs needed for the
 * requested depth; all other filters (status, tag, category, visibility) are
 * applied before it. The total count uses the same fully filtered bounded pairs,
 * so it never counts hidden rows from the unbounded context table.
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
  const pairLimit = sql<number>`greatest(${pageSize} * (${offset}::int / ${pageSize}::int + 1), ${pageSize})`;

  const parentVisibility = and(
    eq(userMemories.userId, ctx.userId),
    layer ? eq(userMemories.memoryLayer, layer) : undefined,
    notTrashed(userMemories.isDeleted),
    visibleMemoryState(userMemories.state),
    memoryFilters,
  );

  const candidateWindow = ctx.db.$with('memory_candidate_window').as(
    ctx.db
      .select({
        contextCreatedAt: sql<Date>`${userMemoriesContexts.createdAt}`.as('context_created_at'),
        contextId: sql<string>`${userMemoriesContexts.id}`.as('context_id'),
        contextUpdatedAt: sql<Date>`${userMemoriesContexts.updatedAt}`.as('context_updated_at'),
        memoryId: sql<string>`${userMemories.id}`.as('memory_id'),
        score: scoreColumn
          ? sql`${scoreColumn}`.as('score_column')
          : sql<null>`NULL`.as('score_column'),
      })
      .from(userMemoriesContexts)
      .innerJoin(
        userMemories,
        and(
          parentVisibility,
          sql<boolean>`COALESCE(${userMemoriesContexts.userMemoryIds}, '[]'::jsonb) ? (${userMemories.id})::text`,
        ),
      )
      .where(and(eq(userMemoriesContexts.userId, ctx.userId), contextFilters, joinedTagFilters))
      .orderBy(
        ...(scoreColumn ? [applyOrder(scoreColumn)] : []),
        applyOrder(userMemoriesContexts.updatedAt),
        applyOrder(userMemoriesContexts.createdAt),
        asc(userMemoriesContexts.id),
        asc(userMemories.id),
      )
      .limit(pairLimit),
  );

  const visiblePairs = ctx.db.$with('memory_visible_pairs').as(
    ctx.db
      .select({
        contextCreatedAt: candidateWindow.contextCreatedAt,
        contextId: candidateWindow.contextId,
        contextUpdatedAt: candidateWindow.contextUpdatedAt,
        memoryId: candidateWindow.memoryId,
        score: candidateWindow.score,
      })
      .from(candidateWindow),
  );

  const pagePairs = ctx.db.$with('memory_context_page').as(
    ctx.db
      .select({
        contextId: visiblePairs.contextId,
        memoryId: visiblePairs.memoryId,
      })
      .from(visiblePairs)
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
