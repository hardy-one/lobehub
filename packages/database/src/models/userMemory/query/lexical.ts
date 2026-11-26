import type {
  SearchMemoryParams,
  UserMemoryActivityWithoutVectors,
  UserMemoryContextWithoutVectors,
  UserMemoryExperienceWithoutVectors,
  UserMemoryIdentityWithoutVectors,
  UserMemoryPreferenceWithoutVectors,
} from '@lobechat/types';
import type { SQL } from 'drizzle-orm';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';

import {
  userMemories,
  userMemoriesActivities,
  userMemoriesContexts,
  userMemoriesExperiences,
  userMemoriesIdentities,
  userMemoriesPreferences,
} from '../../../schemas';
import { normalizeBm25MatchQuery, SAFE_BM25_QUERY_OPTIONS } from '../../../utils/bm25';
import { inJsonStringArray } from '../../../utils/inJsonStringArray';
import type { UserMemoryQueryContext } from './context';
import { collectLexicalCandidateIds } from './lexicalCandidates';
import type { Bm25MatchFieldGroup } from './types';

export const buildBm25MatchCondition = (
  query: string,
  groups: Bm25MatchFieldGroup[],
): SQL | undefined => {
  const matchQuery = normalizeBm25MatchQuery(query, SAFE_BM25_QUERY_OPTIONS);
  const conditions = groups
    .map(({ fields, keyColumn }) => {
      if (fields.length === 0) return undefined;

      const matchQueries = fields.map(
        (field) =>
          sql`paradedb.match(${sql.raw(`'${field}'`)}, ${matchQuery}, conjunction_mode => true)`,
      );

      return sql<boolean>`${keyColumn} @@@ paradedb.boolean(should => ARRAY[${sql.join(matchQueries, sql`, `)}])`;
    })
    .filter((condition): condition is SQL<boolean> => Boolean(condition));

  return conditions.length > 0 ? or(...conditions) : undefined;
};

export async function searchActivitiesLexical(
  ctx: UserMemoryQueryContext,
  query: string | undefined,
  limit: number,
  params: SearchMemoryParams,
) {
  const normalizedQuery = typeof query === 'string' ? query.trim() : '';
  const candidateIds = normalizedQuery
    ? await ctx.fetchFtsSearchCandidates({
        entity: 'memoryActivities',
        fields: [
          'parent_title',
          'parent_summary',
          'parent_details',
          'narrative',
          'notes',
          'feedback',
        ],
        limit,
        query: normalizedQuery,
        searchParams: params,
      })
    : undefined;
  const conditions = [
    ctx.memoryWhere(userMemoriesActivities),
    ctx.memoryWhere(userMemories),
    params.categories?.length ? inArray(userMemories.memoryCategory, params.categories) : undefined,
    params.status?.length ? inArray(userMemoriesActivities.status, params.status) : undefined,
    params.types?.length ? inArray(userMemoriesActivities.type, params.types) : undefined,
    ctx.buildTimeRangeCondition(
      {
        capturedAt: userMemoriesActivities.capturedAt,
        createdAt: userMemoriesActivities.createdAt,
        endsAt: userMemoriesActivities.endsAt,
        startsAt: userMemoriesActivities.startsAt,
        updatedAt: userMemoriesActivities.updatedAt,
      },
      params.timeRange,
    ),
    normalizedQuery && !candidateIds
      ? inJsonStringArray(
          userMemoriesActivities.id,
          await collectLexicalCandidateIds(ctx, userMemoriesActivities, {
            child: buildBm25MatchCondition(normalizedQuery, [
              {
                fields: ['narrative', 'notes', 'feedback'],
                keyColumn: userMemoriesActivities.id,
              },
            ])!,
            parent: buildBm25MatchCondition(normalizedQuery, [
              { fields: ['title', 'summary', 'details'], keyColumn: userMemories.id },
            ])!,
          }),
        )
      : candidateIds
        ? inJsonStringArray(userMemoriesActivities.id, candidateIds)
        : undefined,
    ctx.buildExactTagFilterCondition(userMemoriesActivities.tags, userMemories.tags, params),
  ].filter((condition): condition is SQL => Boolean(condition));

  const rowsQuery = ctx.db
    .select({
      dossierId: userMemoriesActivities.dossierId,
      injectable: userMemoriesActivities.injectable,
      accessedAt: userMemoriesActivities.accessedAt,
      associatedLocations: userMemoriesActivities.associatedLocations,
      associatedObjects: userMemoriesActivities.associatedObjects,
      associatedSubjects: userMemoriesActivities.associatedSubjects,
      capturedAt: userMemoriesActivities.capturedAt,
      createdAt: userMemoriesActivities.createdAt,
      endsAt: userMemoriesActivities.endsAt,
      feedback: userMemoriesActivities.feedback,
      id: userMemoriesActivities.id,
      metadata: userMemoriesActivities.metadata,
      narrative: userMemoriesActivities.narrative,
      notes: userMemoriesActivities.notes,
      startsAt: userMemoriesActivities.startsAt,
      status: userMemoriesActivities.status,
      tags: userMemoriesActivities.tags,
      timezone: userMemoriesActivities.timezone,
      type: userMemoriesActivities.type,
      updatedAt: userMemoriesActivities.updatedAt,
      userId: userMemoriesActivities.userId,
      userMemoryId: userMemoriesActivities.userMemoryId,
    })
    .from(userMemoriesActivities)
    .innerJoin(userMemories, eq(userMemories.id, userMemoriesActivities.userMemoryId))
    .where(and(...conditions))
    .orderBy(desc(userMemoriesActivities.capturedAt), desc(userMemoriesActivities.createdAt))
    .limit(limit);

  return rowsQuery as Promise<UserMemoryActivityWithoutVectors[]>;
}

export async function searchContextsLexical(
  ctx: UserMemoryQueryContext,
  query: string | undefined,
  limit: number,
  params: SearchMemoryParams,
) {
  const normalizedQuery = typeof query === 'string' ? query.trim() : '';
  const candidateIds = normalizedQuery
    ? await ctx.fetchFtsSearchCandidates({
        entity: 'memoryContexts',
        fields: ['parent_text', 'title', 'description', 'current_status'],
        limit,
        query: normalizedQuery,
        searchParams: params,
      })
    : undefined;
  const conditions = [
    ctx.memoryWhere(userMemoriesContexts),
    params.categories?.length
      ? sql`EXISTS (
          SELECT 1
          FROM ${userMemories}
          WHERE ${userMemories.id} IN (
            SELECT ${userMemoriesContexts.userMemoryId}
            UNION ALL
            SELECT jsonb_array_elements_text(${userMemoriesContexts.userMemoryIds})
          )
            AND ${userMemories.userId} = ${userMemoriesContexts.userId}
            AND ${userMemories.isDeleted} IS NOT TRUE
            AND (${userMemories.state} IS NULL OR ${userMemories.state} <> ALL (ARRAY['superseded', 'rejected']))
            AND ${userMemories.memoryCategory} IN (${sql.join(
              params.categories.map((category) => sql`${category}`),
              sql`, `,
            )})
        )`
      : undefined,
    params.status?.length ? inArray(userMemoriesContexts.currentStatus, params.status) : undefined,
    params.types?.length ? inArray(userMemoriesContexts.type, params.types) : undefined,
    ctx.buildTimeRangeCondition(
      {
        capturedAt: userMemoriesContexts.capturedAt,
        createdAt: userMemoriesContexts.createdAt,
        updatedAt: userMemoriesContexts.updatedAt,
      },
      params.timeRange,
    ),
    normalizedQuery && !candidateIds
      ? inJsonStringArray(
          userMemoriesContexts.id,
          await collectLexicalCandidateIds(ctx, userMemoriesContexts, {
            child: buildBm25MatchCondition(normalizedQuery, [
              {
                fields: ['title', 'description', 'current_status'],
                keyColumn: userMemoriesContexts.id,
              },
            ])!,
            parent: buildBm25MatchCondition(normalizedQuery, [
              { fields: ['title', 'summary', 'details'], keyColumn: userMemories.id },
            ])!,
          }),
        )
      : candidateIds
        ? inJsonStringArray(userMemoriesContexts.id, candidateIds)
        : undefined,
    ctx.buildExactTagFilterCondition(
      userMemoriesContexts.tags,
      sql`ARRAY(
      SELECT tag
      FROM ${userMemories}
      CROSS JOIN LATERAL unnest(${userMemories.tags}) AS tag
      WHERE ${userMemories.id} IN (
        SELECT ${userMemoriesContexts.userMemoryId}
        UNION ALL
        SELECT jsonb_array_elements_text(${userMemoriesContexts.userMemoryIds})
      )
        AND ${userMemories.userId} = ${userMemoriesContexts.userId}
        AND ${userMemories.isDeleted} IS NOT TRUE
        AND (${userMemories.state} IS NULL OR ${userMemories.state} <> ALL (ARRAY['superseded', 'rejected']))
    )`,
      params,
    ),
  ].filter((condition): condition is SQL => Boolean(condition));

  const rowsQuery = ctx.db
    .select({
      accessedAt: userMemoriesContexts.accessedAt,
      associatedObjects: userMemoriesContexts.associatedObjects,
      associatedSubjects: userMemoriesContexts.associatedSubjects,
      capturedAt: userMemoriesContexts.capturedAt,
      createdAt: userMemoriesContexts.createdAt,
      currentStatus: userMemoriesContexts.currentStatus,
      description: userMemoriesContexts.description,
      firstSeenAt: userMemoriesContexts.firstSeenAt,
      id: userMemoriesContexts.id,
      lastEvidenceAt: userMemoriesContexts.lastEvidenceAt,
      metadata: userMemoriesContexts.metadata,
      nextSteps: userMemoriesContexts.nextSteps,
      now: userMemoriesContexts.now,
      openQuestions: userMemoriesContexts.openQuestions,
      scoreImpact: userMemoriesContexts.scoreImpact,
      scoreUrgency: userMemoriesContexts.scoreUrgency,
      synthesizedAt: userMemoriesContexts.synthesizedAt,
      tags: userMemoriesContexts.tags,
      title: userMemoriesContexts.title,
      type: userMemoriesContexts.type,
      updatedAt: userMemoriesContexts.updatedAt,
      userId: userMemoriesContexts.userId,
      userMemoryId: userMemoriesContexts.userMemoryId,
      userMemoryIds: userMemoriesContexts.userMemoryIds,
    })
    .from(userMemoriesContexts)
    .where(and(...conditions))
    .orderBy(desc(userMemoriesContexts.capturedAt), desc(userMemoriesContexts.createdAt))
    .limit(limit);

  return rowsQuery as Promise<UserMemoryContextWithoutVectors[]>;
}

export async function searchExperiencesLexical(
  ctx: UserMemoryQueryContext,
  query: string | undefined,
  limit: number,
  params: SearchMemoryParams,
) {
  const normalizedQuery = typeof query === 'string' ? query.trim() : '';
  const candidateIds = normalizedQuery
    ? await ctx.fetchFtsSearchCandidates({
        entity: 'memoryExperiences',
        fields: [
          'parent_title',
          'parent_summary',
          'parent_details',
          'situation',
          'reasoning',
          'possible_outcome',
          'action',
          'key_learning',
        ],
        limit,
        query: normalizedQuery,
        searchParams: params,
      })
    : undefined;
  const conditions = [
    ctx.memoryWhere(userMemoriesExperiences),
    ctx.memoryWhere(userMemories),
    params.categories?.length ? inArray(userMemories.memoryCategory, params.categories) : undefined,
    params.types?.length ? inArray(userMemoriesExperiences.type, params.types) : undefined,
    ctx.buildTimeRangeCondition(
      {
        capturedAt: userMemoriesExperiences.capturedAt,
        createdAt: userMemoriesExperiences.createdAt,
        updatedAt: userMemoriesExperiences.updatedAt,
      },
      params.timeRange,
    ),
    normalizedQuery && !candidateIds
      ? inJsonStringArray(
          userMemoriesExperiences.id,
          await collectLexicalCandidateIds(ctx, userMemoriesExperiences, {
            child: buildBm25MatchCondition(normalizedQuery, [
              {
                fields: ['situation', 'key_learning', 'action', 'reasoning', 'possible_outcome'],
                keyColumn: userMemoriesExperiences.id,
              },
            ])!,
            parent: buildBm25MatchCondition(normalizedQuery, [
              { fields: ['title', 'summary', 'details'], keyColumn: userMemories.id },
            ])!,
          }),
        )
      : candidateIds
        ? inJsonStringArray(userMemoriesExperiences.id, candidateIds)
        : undefined,
    ctx.buildExactTagFilterCondition(userMemoriesExperiences.tags, userMemories.tags, params),
  ].filter((condition): condition is SQL => Boolean(condition));

  const rowsQuery = ctx.db
    .select({
      accessedAt: userMemoriesExperiences.accessedAt,
      action: userMemoriesExperiences.action,
      capturedAt: userMemoriesExperiences.capturedAt,
      createdAt: userMemoriesExperiences.createdAt,
      id: userMemoriesExperiences.id,
      keyLearning: userMemoriesExperiences.keyLearning,
      metadata: userMemoriesExperiences.metadata,
      possibleOutcome: userMemoriesExperiences.possibleOutcome,
      reasoning: userMemoriesExperiences.reasoning,
      scoreConfidence: userMemoriesExperiences.scoreConfidence,
      situation: userMemoriesExperiences.situation,
      tags: userMemoriesExperiences.tags,
      type: userMemoriesExperiences.type,
      updatedAt: userMemoriesExperiences.updatedAt,
      userId: userMemoriesExperiences.userId,
      userMemoryId: userMemoriesExperiences.userMemoryId,
    })
    .from(userMemoriesExperiences)
    .innerJoin(userMemories, eq(userMemories.id, userMemoriesExperiences.userMemoryId))
    .where(and(...conditions))
    .orderBy(desc(userMemoriesExperiences.capturedAt), desc(userMemoriesExperiences.createdAt))
    .limit(limit);

  return rowsQuery as Promise<UserMemoryExperienceWithoutVectors[]>;
}

export async function searchPreferencesLexical(
  ctx: UserMemoryQueryContext,
  query: string | undefined,
  limit: number,
  params: SearchMemoryParams,
) {
  const normalizedQuery = typeof query === 'string' ? query.trim() : '';
  const candidateIds = normalizedQuery
    ? await ctx.fetchFtsSearchCandidates({
        entity: 'memoryPreferences',
        fields: [
          'parent_title',
          'parent_summary',
          'parent_details',
          'conclusion_directives',
          'suggestions',
        ],
        limit,
        query: normalizedQuery,
        searchParams: params,
      })
    : undefined;
  const conditions = [
    ctx.memoryWhere(userMemoriesPreferences),
    ctx.memoryWhere(userMemories),
    params.categories?.length ? inArray(userMemories.memoryCategory, params.categories) : undefined,
    params.types?.length ? inArray(userMemoriesPreferences.type, params.types) : undefined,
    ctx.buildTimeRangeCondition(
      {
        capturedAt: userMemoriesPreferences.capturedAt,
        createdAt: userMemoriesPreferences.createdAt,
        updatedAt: userMemoriesPreferences.updatedAt,
      },
      params.timeRange,
    ),
    normalizedQuery && !candidateIds
      ? inJsonStringArray(
          userMemoriesPreferences.id,
          await collectLexicalCandidateIds(ctx, userMemoriesPreferences, {
            child: buildBm25MatchCondition(normalizedQuery, [
              {
                fields: ['conclusion_directives', 'suggestions'],
                keyColumn: userMemoriesPreferences.id,
              },
            ])!,
            parent: buildBm25MatchCondition(normalizedQuery, [
              { fields: ['title', 'summary', 'details'], keyColumn: userMemories.id },
            ])!,
          }),
        )
      : candidateIds
        ? inJsonStringArray(userMemoriesPreferences.id, candidateIds)
        : undefined,
    ctx.buildExactTagFilterCondition(userMemoriesPreferences.tags, userMemories.tags, params),
  ].filter((condition): condition is SQL => Boolean(condition));

  const rowsQuery = ctx.db
    .select({
      appliesToEntityId: userMemoriesPreferences.appliesToEntityId,
      evidenceCount: userMemoriesPreferences.evidenceCount,
      evidenceSource: userMemoriesPreferences.evidenceSource,
      holderEntityId: userMemoriesPreferences.holderEntityId,
      lastEvidenceAt: userMemoriesPreferences.lastEvidenceAt,
      scope: userMemoriesPreferences.scope,
      accessedAt: userMemoriesPreferences.accessedAt,
      capturedAt: userMemoriesPreferences.capturedAt,
      conclusionDirectives: userMemoriesPreferences.conclusionDirectives,
      createdAt: userMemoriesPreferences.createdAt,
      id: userMemoriesPreferences.id,
      metadata: userMemoriesPreferences.metadata,
      scorePriority: userMemoriesPreferences.scorePriority,
      suggestions: userMemoriesPreferences.suggestions,
      tags: userMemoriesPreferences.tags,
      type: userMemoriesPreferences.type,
      updatedAt: userMemoriesPreferences.updatedAt,
      userId: userMemoriesPreferences.userId,
      userMemoryId: userMemoriesPreferences.userMemoryId,
    })
    .from(userMemoriesPreferences)
    .innerJoin(userMemories, eq(userMemories.id, userMemoriesPreferences.userMemoryId))
    .where(and(...conditions))
    .orderBy(desc(userMemoriesPreferences.capturedAt), desc(userMemoriesPreferences.createdAt))
    .limit(limit);

  return rowsQuery as Promise<UserMemoryPreferenceWithoutVectors[]>;
}

export async function searchIdentitiesLexical(
  ctx: UserMemoryQueryContext,
  query: string | undefined,
  limit: number,
  params: SearchMemoryParams,
) {
  const normalizedQuery = typeof query === 'string' ? query.trim() : '';
  const candidateIds = normalizedQuery
    ? await ctx.fetchFtsSearchCandidates({
        entity: 'memoryIdentities',
        fields: ['parent_title', 'parent_summary', 'parent_details', 'description', 'role'],
        limit,
        query: normalizedQuery,
        searchParams: params,
      })
    : undefined;
  const conditions = [
    ctx.memoryWhere(userMemoriesIdentities),
    ctx.memoryWhere(userMemories),
    params.categories?.length ? inArray(userMemories.memoryCategory, params.categories) : undefined,
    params.relationships?.length
      ? inArray(userMemoriesIdentities.relationship, params.relationships)
      : undefined,
    params.types?.length ? inArray(userMemoriesIdentities.type, params.types) : undefined,
    ctx.buildTimeRangeCondition(
      {
        capturedAt: userMemoriesIdentities.capturedAt,
        createdAt: userMemoriesIdentities.createdAt,
        episodicDate: userMemoriesIdentities.episodicDate,
        updatedAt: userMemoriesIdentities.updatedAt,
      },
      params.timeRange,
    ),
    normalizedQuery && !candidateIds
      ? inJsonStringArray(
          userMemoriesIdentities.id,
          await collectLexicalCandidateIds(ctx, userMemoriesIdentities, {
            child: buildBm25MatchCondition(normalizedQuery, [
              { fields: ['description', 'role'], keyColumn: userMemoriesIdentities.id },
            ])!,
            parent: buildBm25MatchCondition(normalizedQuery, [
              { fields: ['title', 'summary', 'details'], keyColumn: userMemories.id },
            ])!,
          }),
        )
      : candidateIds
        ? inJsonStringArray(userMemoriesIdentities.id, candidateIds)
        : undefined,
    ctx.buildExactTagFilterCondition(userMemoriesIdentities.tags, userMemories.tags, params),
  ].filter((condition): condition is SQL => Boolean(condition));

  const rowsQuery = ctx.db
    .select({
      entityId: userMemoriesIdentities.entityId,
      accessedAt: userMemoriesIdentities.accessedAt,
      capturedAt: userMemoriesIdentities.capturedAt,
      createdAt: userMemoriesIdentities.createdAt,
      description: userMemoriesIdentities.description,
      episodicDate: userMemoriesIdentities.episodicDate,
      id: userMemoriesIdentities.id,
      metadata: userMemoriesIdentities.metadata,
      relationship: userMemoriesIdentities.relationship,
      role: userMemoriesIdentities.role,
      tags: userMemoriesIdentities.tags,
      type: userMemoriesIdentities.type,
      updatedAt: userMemoriesIdentities.updatedAt,
      userId: userMemoriesIdentities.userId,
      userMemoryId: userMemoriesIdentities.userMemoryId,
    })
    .from(userMemoriesIdentities)
    .innerJoin(userMemories, eq(userMemories.id, userMemoriesIdentities.userMemoryId))
    .where(and(...conditions))
    .orderBy(desc(userMemoriesIdentities.capturedAt), desc(userMemoriesIdentities.createdAt))
    .limit(limit);

  return rowsQuery as Promise<UserMemoryIdentityWithoutVectors[]>;
}
