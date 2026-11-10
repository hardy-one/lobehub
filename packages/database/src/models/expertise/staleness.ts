import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';

import { expertiseDomains, expertiseHits, expertiseLessons } from '../../schemas';
import type { ExpertiseContext } from './context';
import { domainScopeWhere } from './context';

export interface RetireStaleLessonsOptions {
  /**
   * Distinct practice runs inside the window that count as "still in use".
   * Runs, not hits: one delivery can cite the same lesson in several places,
   * which would make a single session look like sustained use.
   */
  maxRuns?: number;
  /**
   * A lesson must exist this long before it is eligible. Without it a lesson
   * learned yesterday would be retired tonight for having no history yet.
   */
  minAgeDays?: number;
  /** Trailing window the runs are counted in. */
  windowDays?: number;
}

export interface RetiredLesson {
  code: string;
  domainId: string;
  id: string;
  runsInWindow: number;
}

export interface RetireStaleLessonsResult {
  retired: RetiredLesson[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Retires lessons that have not been applied in any recent practice run.
 *
 * This answers "is it still earning its place in the prompt", not "is it
 * wrong". A retired lesson keeps its row and evidence, so the decision is
 * reversible and the history stays readable.
 */
export const retireStaleLessons = async (
  ctx: ExpertiseContext,
  options: RetireStaleLessonsOptions = {},
): Promise<RetireStaleLessonsResult> => {
  const { maxRuns = 3, minAgeDays = 7, windowDays = 7 } = options;
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowDays * DAY_MS);
  const ageCutoff = new Date(now.getTime() - minAgeDays * DAY_MS);

  const stale = await ctx.db
    .select({
      code: expertiseLessons.code,
      domainId: expertiseLessons.domainId,
      id: expertiseLessons.id,
      runsInWindow: sql<number>`count(distinct ${expertiseHits.runId})::int`,
    })
    .from(expertiseLessons)
    .innerJoin(expertiseDomains, eq(expertiseDomains.id, expertiseLessons.domainId))
    .leftJoin(
      expertiseHits,
      and(
        eq(expertiseHits.lessonId, expertiseLessons.id),
        gte(expertiseHits.createdAt, windowStart),
      ),
    )
    .where(
      and(
        eq(expertiseLessons.status, 'active'),
        lt(expertiseLessons.createdAt, ageCutoff),
        domainScopeWhere(ctx),
      ),
    )
    .groupBy(expertiseLessons.id, expertiseLessons.code, expertiseLessons.domainId)
    .having(sql`count(distinct ${expertiseHits.runId}) <= ${maxRuns}`);

  if (stale.length === 0) return { retired: [] };

  await ctx.db
    .update(expertiseLessons)
    .set({
      rejectedReason: `auto-retired: ${maxRuns} or fewer runs in ${windowDays}d`,
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

  return {
    retired: stale.map((lesson) => ({
      code: lesson.code,
      domainId: lesson.domainId,
      id: lesson.id,
      runsInWindow: Number(lesson.runsInWindow),
    })),
  };
};
