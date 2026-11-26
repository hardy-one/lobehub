import type { AnyColumn, SQL } from 'drizzle-orm';
import { and, asc, desc, eq, sql } from 'drizzle-orm';

import { userMemories, userMemoriesContexts } from '../../../schemas';
import type { UserMemoryModelContext } from './context';

interface ContextVisibilityParams {
  contextFilters?: SQL | undefined;
  ctx: UserMemoryModelContext;
  joinedTagFilters?: string[] | undefined;
  layer?: string;
  memoryFilters?: SQL | undefined;
  offset: number;
  order?: 'asc' | 'desc';
  pageSize: number;
  scoreColumn?: SQL | AnyColumn;
}

/**
 * Paginates management Context rows before looking up visible parent memories.
 * The parent lookup is a correlated EXISTS over the paged set, so LIMIT/OFFSET
 * is applied before any context × parent join is evaluated.
 */
export const buildContextVisibilityCte = ({
  ctx,
  layer,
  order = 'desc',
  offset,
  pageSize,
  contextFilters,
  memoryFilters,
  scoreColumn,
}: ContextVisibilityParams) => {
  const applyOrder = order === 'asc' ? asc : desc;

  const contextPage = ctx.db.$with('memory_context_page').as(
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
      .limit(pageSize)
      .offset(offset),
  );

  const parentExists = sql<boolean>`EXISTS (
    SELECT 1 FROM ${userMemories}
    WHERE ${and(
      eq(userMemories.userId, ctx.userId),
      layer ? eq(userMemories.memoryLayer, layer) : undefined,
      memoryFilters,
    )}
      AND COALESCE(${contextPage.userMemoryIds}, '[]'::jsonb) ? (${userMemories.id})::text
  )`;

  return { applyOrder, contextPage, parentExists };
};
