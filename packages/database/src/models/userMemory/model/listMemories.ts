import type {
  UserMemoryActivity,
  UserMemoryContext,
  UserMemoryDetail,
  UserMemoryExperience,
  UserMemoryIdentity,
  UserMemoryPreference,
} from '@lobechat/types';
import { LayersEnum } from '@lobechat/types';
import type { AnyColumn, SQL } from 'drizzle-orm';
import { and, asc, desc, eq } from 'drizzle-orm';

import {
  userMemories,
  userMemoriesContexts,
  userMemoriesExperiences,
  userMemoriesIdentities,
  userMemoriesPreferences,
} from '../../../schemas';
import { selectNonVectorColumns } from '../../../utils/columns';
import type { UserMemoryModelContext } from './context';
import { buildContextVisibilityCte } from './contextVisibility';

export type ListMemoriesItem<L extends LayersEnum> = L extends LayersEnum.Context
  ? UserMemoryDetail & {
      context: UserMemoryContext;
      layer: LayersEnum.Context;
    }
  : L extends LayersEnum.Experience
    ? UserMemoryDetail & {
        experience: UserMemoryExperience;
        layer: LayersEnum.Experience;
      }
    : L extends LayersEnum.Identity
      ? UserMemoryDetail & {
          identity: UserMemoryIdentity;
          layer: LayersEnum.Identity;
        }
      : L extends LayersEnum.Preference
        ? UserMemoryDetail & {
            layer: LayersEnum.Preference;
            preference: UserMemoryPreference;
          }
        : L extends LayersEnum.Activity
          ? UserMemoryDetail & {
              activity: UserMemoryActivity;
              layer: LayersEnum.Activity;
            }
          : never;

export interface ListMemoriesParams<L extends LayersEnum> {
  layer?: L;
  order?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

/**
 * NOTICE: internal service / backend / data aggregation use only, for most of the UI related use-cases,
 * please use `queryMemories` method instead.
 */
export const listMemories = async <
  L extends LayersEnum,
  R extends UserMemoryDetail = ListMemoriesItem<L>,
>(
  ctx: UserMemoryModelContext,
  params: ListMemoriesParams<L>,
): Promise<R[]> => {
  const { layer = LayersEnum.Context, order = 'desc', page = 1, pageSize = 20 } = params;

  const normalizedPage = Math.max(1, page ?? 1);
  const normalizedPageSize = Math.min(Math.max(pageSize ?? 20, 1), 100);
  const offset = (normalizedPage - 1) * normalizedPageSize;
  const applyOrder = order === 'asc' ? asc : desc;

  const baseSelection = selectNonVectorColumns(userMemories);
  const contextSelection = selectNonVectorColumns(userMemoriesContexts);
  const experienceSelection = selectNonVectorColumns(userMemoriesExperiences);
  const identitySelection = selectNonVectorColumns(userMemoriesIdentities);
  const preferenceSelection = selectNonVectorColumns(userMemoriesPreferences);
  // TODO(@nekomeowww): extract a shared selection for the activity branch.

  const baseWhere = and(ctx.memoryWhere(userMemories), eq(userMemories.memoryLayer, layer));

  const buildOrderBy = (updatedAtColumn: AnyColumn | SQL, createdAtColumn: AnyColumn | SQL) =>
    [applyOrder(updatedAtColumn), applyOrder(createdAtColumn)].filter(
      (item): item is SQL => item !== undefined,
    );

  switch (layer) {
    case LayersEnum.Context: {
      const { applyOrder, candidateWindow, pagePairs, visiblePairs } = buildContextVisibilityCte({
        ctx,
        layer,
        offset,
        order,
        pageSize: normalizedPageSize,
      });

      const rows = await ctx.db
        .with(candidateWindow, visiblePairs, pagePairs)
        .select({
          context: contextSelection,
          memory: baseSelection,
        })
        .from(pagePairs)
        .innerJoin(userMemoriesContexts, eq(userMemoriesContexts.id, pagePairs.contextId))
        .innerJoin(userMemories, eq(userMemories.id, pagePairs.memoryId))
        .orderBy(
          applyOrder(userMemoriesContexts.updatedAt),
          applyOrder(userMemoriesContexts.createdAt),
          asc(userMemoriesContexts.id),
          asc(userMemories.id),
        );

      return rows.map((row) => ({
        context: row.context,
        layer: LayersEnum.Context,
        memory: row.memory,
      })) as unknown as R[];
    }
    case LayersEnum.Experience: {
      const orderByClauses = buildOrderBy(
        userMemoriesExperiences.updatedAt,
        userMemoriesExperiences.createdAt,
      );
      const joinCondition = and(
        eq(userMemories.id, userMemoriesExperiences.userMemoryId),
        ctx.memoryWhere(userMemoriesExperiences),
      );

      const rows = await ctx.db
        .select({
          experience: experienceSelection,
          memory: baseSelection,
        })
        .from(userMemories)
        .innerJoin(userMemoriesExperiences, joinCondition)
        .where(baseWhere)
        .orderBy(...orderByClauses)
        .limit(normalizedPageSize)
        .offset(offset);

      return rows.map((row) => ({
        experience: row.experience,
        layer: LayersEnum.Experience,
        memory: row.memory,
      })) as unknown as R[];
    }
    case LayersEnum.Identity: {
      const orderByClauses = buildOrderBy(
        userMemoriesIdentities.updatedAt,
        userMemoriesIdentities.createdAt,
      );
      const joinCondition = and(
        eq(userMemories.id, userMemoriesIdentities.userMemoryId),
        ctx.memoryWhere(userMemoriesIdentities),
      );

      const rows = await ctx.db
        .select({
          identity: identitySelection,
          memory: baseSelection,
        })
        .from(userMemories)
        .innerJoin(userMemoriesIdentities, joinCondition)
        .where(baseWhere)
        .orderBy(...orderByClauses)
        .limit(normalizedPageSize)
        .offset(offset);

      return rows.map((row) => ({
        identity: row.identity,
        layer: LayersEnum.Identity,
        memory: row.memory,
      })) as unknown as R[];
    }
    case LayersEnum.Preference: {
      const orderByClauses = buildOrderBy(
        userMemoriesPreferences.updatedAt,
        userMemoriesPreferences.createdAt,
      );
      const joinCondition = and(
        eq(userMemories.id, userMemoriesPreferences.userMemoryId),
        ctx.memoryWhere(userMemoriesPreferences),
      );

      const rows = await ctx.db
        .select({
          memory: baseSelection,
          preference: preferenceSelection,
        })
        .from(userMemories)
        .innerJoin(userMemoriesPreferences, joinCondition)
        .where(baseWhere)
        .orderBy(...orderByClauses)
        .limit(normalizedPageSize)
        .offset(offset);

      return rows.map((row) => ({
        layer: LayersEnum.Preference,
        memory: row.memory,
        preference: row.preference,
      })) as unknown as R[];
    }
  }

  return [];
};
