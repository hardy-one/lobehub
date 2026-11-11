import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import {
  expertiseBindings,
  expertiseDomains,
  expertiseHits,
  expertiseLessons,
  expertiseRuns,
  topics,
} from '../../schemas';
import type { ExpertiseContext } from './context';
import { domainScopeWhere } from './context';

export interface RetireStaleLessonsOptions {
  /** Hits inside the window at or below which a lesson counts as unused. */
  maxHits?: number;
  /**
   * How many of the responsible agents' most recent topics the window covers.
   * Topics, not runs: a run exists only when a review judged the topic relevant
   * to the domain, so skipped or merged topics would silently shrink the
   * window and make an active lesson look unused.
   */
  windowTopics?: number;
}

export interface RetiredLesson {
  code: string;
  domainId: string;
  hitsInWindow: number;
  id: string;
}

export interface SkippedDomain {
  domainId: string;
  reason: 'no-agent' | 'no-topics' | 'young';
  title: string;
}

export interface RetireStaleLessonsResult {
  retired: RetiredLesson[];
  skipped: SkippedDomain[];
}

/**
 * Which topics a domain's window is drawn from.
 *
 * An explicit agent binding scopes the window to those agents. A user-level
 * binding means the domain is shared across the owner's whole roster, so the
 * window is the owner's own recent topics — scoping it to one agent would make
 * a domain look unused while another agent keeps applying it.
 */
type DomainScope = { agentIds: string[]; kind: 'agents' } | { kind: 'user' };

const resolveDomainScope = async (
  ctx: ExpertiseContext,
  domainId: string,
): Promise<DomainScope | null> => {
  const bindings = await ctx.db
    .select({
      agentId: expertiseBindings.agentId,
      boundUserId: expertiseBindings.boundUserId,
    })
    .from(expertiseBindings)
    .where(and(eq(expertiseBindings.domainId, domainId), eq(expertiseBindings.enabled, true)));

  const agentIds = bindings.map((binding) => binding.agentId).filter((id): id is string => !!id);

  if (agentIds.length > 0) return { agentIds, kind: 'agents' };
  if (bindings.some((binding) => binding.boundUserId === ctx.userId)) return { kind: 'user' };

  return null;
};

const scopeWhere = (ctx: ExpertiseContext, scope: DomainScope) =>
  scope.kind === 'user' ? eq(topics.userId, ctx.userId) : inArray(topics.agentId, scope.agentIds);

/**
 * Retires lessons that no hit inside the domain's recent-topic window touches.
 *
 * The window asks "was this lesson applied in the last N topics these agents
 * worked on", which survives a change of task mix better than a calendar date:
 * a quiet fortnight does not by itself condemn a lesson, but a hundred topics
 * that never touched it does.
 */
export const retireStaleLessons = async (
  ctx: ExpertiseContext,
  options: RetireStaleLessonsOptions = {},
): Promise<RetireStaleLessonsResult> => {
  const { maxHits = 3, windowTopics = 100 } = options;
  const now = new Date();
  const retired: RetiredLesson[] = [];
  const skipped: SkippedDomain[] = [];

  const domains = await ctx.db
    .select({ id: expertiseDomains.id, title: expertiseDomains.title })
    .from(expertiseDomains)
    .where(domainScopeWhere(ctx));

  for (const domain of domains) {
    const scope = await resolveDomainScope(ctx, domain.id);
    if (!scope) {
      skipped.push({ domainId: domain.id, reason: 'no-agent', title: domain.title });
      continue;
    }

    const where = scopeWhere(ctx, scope);

    const [total] = await ctx.db
      .select({ value: sql<number>`count(*)::int` })
      .from(topics)
      .where(where);

    // A domain that has not seen a full window yet has no meaningful zero-hit
    // verdict: every lesson would read as unused the day it is written.
    if (Number(total?.value ?? 0) < windowTopics) {
      skipped.push({ domainId: domain.id, reason: 'young', title: domain.title });
      continue;
    }

    const windowRows = await ctx.db
      .select({ id: topics.id })
      .from(topics)
      .where(where)
      .orderBy(desc(topics.updatedAt))
      .limit(windowTopics);

    const windowTopicIds = windowRows.map((row) => row.id);
    if (windowTopicIds.length === 0) {
      skipped.push({ domainId: domain.id, reason: 'no-topics', title: domain.title });
      continue;
    }

    // Count only hits whose run points at a topic inside the window. Hits from
    // acceptance or goal-gate runs are real evidence, but they do not belong to
    // a topic window and would otherwise keep a lesson alive indefinitely.
    const counts = await ctx.db
      .select({
        code: expertiseLessons.code,
        hits: sql<number>`count(${expertiseRuns.id})::int`,
        id: expertiseLessons.id,
      })
      .from(expertiseLessons)
      .leftJoin(expertiseHits, eq(expertiseHits.lessonId, expertiseLessons.id))
      .leftJoin(
        expertiseRuns,
        and(
          eq(expertiseRuns.id, expertiseHits.runId),
          eq(expertiseRuns.subjectType, 'topic'),
          inArray(expertiseRuns.subjectId, windowTopicIds),
        ),
      )
      .where(and(eq(expertiseLessons.domainId, domain.id), eq(expertiseLessons.status, 'active')))
      .groupBy(expertiseLessons.id, expertiseLessons.code);

    const stale = counts.filter((lesson) => Number(lesson.hits) <= maxHits);
    if (stale.length === 0) continue;

    await ctx.db
      .update(expertiseLessons)
      .set({
        rejectedReason: `auto-retired: ${maxHits} or fewer hits in the last ${windowTopics} topics`,
        retiredAt: now,
        status: 'retired',
        updatedAt: now,
      })
      .where(
        inArray(
          expertiseLessons.id,
          stale.map((lesson) => lesson.id),
        ),
      );

    retired.push(
      ...stale.map((lesson) => ({
        code: lesson.code,
        domainId: domain.id,
        hitsInWindow: Number(lesson.hits),
        id: lesson.id,
      })),
    );
  }

  return { retired, skipped };
};
