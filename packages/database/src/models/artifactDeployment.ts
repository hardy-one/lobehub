import { and, desc, eq, sql } from 'drizzle-orm';

import {
  type ArtifactDeploymentItem,
  type ArtifactDeploymentRevisionItem,
  artifactDeploymentRevisions,
  artifactDeployments,
  type NewArtifactDeployment,
  type NewArtifactDeploymentRevision,
} from '../schemas';
import type { LobeChatDatabase } from '../type';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

export class ArtifactDeploymentModel {
  private db: LobeChatDatabase;
  private userId: string;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  // artifact_deployments has no visibility column, so only the scope columns are
  // passed to buildWorkspaceWhere.
  private ownership = () =>
    buildWorkspaceWhere(
      { userId: this.userId, workspaceId: this.workspaceId },
      { userId: artifactDeployments.userId, workspaceId: artifactDeployments.workspaceId },
    );

  /**
   * Resolve an Artifact by the address the conversation uses for it. Scoped to
   * the caller: the same identifier in another user's topic is a different
   * Artifact and must not be found here.
   */
  findByArtifact = async ({
    identifier,
    topicId,
  }: {
    identifier: string;
    topicId: string;
  }): Promise<ArtifactDeploymentItem | undefined> => {
    const [result] = await this.db
      .select()
      .from(artifactDeployments)
      .where(
        and(
          eq(artifactDeployments.identifier, identifier),
          eq(artifactDeployments.topicId, topicId),
          this.ownership(),
        ),
      )
      .limit(1);

    return result;
  };

  findById = async (id: string): Promise<ArtifactDeploymentItem | undefined> => {
    const [result] = await this.db
      .select()
      .from(artifactDeployments)
      .where(and(eq(artifactDeployments.id, id), this.ownership()))
      .limit(1);

    return result;
  };

  /** Deployments of one topic, newest first. */
  listByTopic = async (topicId: string): Promise<ArtifactDeploymentItem[]> =>
    this.db
      .select()
      .from(artifactDeployments)
      .where(and(eq(artifactDeployments.topicId, topicId), this.ownership()))
      .orderBy(desc(artifactDeployments.createdAt));

  /** The id is minted by the caller: the upload prefix is derived from it. */
  create = async (
    values: Omit<NewArtifactDeployment, 'userId' | 'workspaceId'> & { id: string },
  ): Promise<ArtifactDeploymentItem> => {
    const [result] = await this.db
      .insert(artifactDeployments)
      .values(buildWorkspacePayload({ userId: this.userId, workspaceId: this.workspaceId }, values))
      .returning();

    return result;
  };

  update = async (
    id: string,
    values: Partial<NewArtifactDeployment>,
  ): Promise<ArtifactDeploymentItem | undefined> => {
    // Ownership columns are fixed by the constructor scope; a patch may only
    // touch the deployment's own fields.
    const patch: Partial<NewArtifactDeployment> = { ...values };
    delete patch.userId;
    delete patch.workspaceId;

    const [result] = await this.db
      .update(artifactDeployments)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(artifactDeployments.id, id), this.ownership()))
      .returning();

    return result;
  };

  remove = async (id: string): Promise<void> => {
    await this.db
      .delete(artifactDeployments)
      .where(and(eq(artifactDeployments.id, id), this.ownership()));
  };

  addRevision = async (
    values: NewArtifactDeploymentRevision,
  ): Promise<ArtifactDeploymentRevisionItem> => {
    const [result] = await this.db.insert(artifactDeploymentRevisions).values(values).returning();

    return result;
  };

  /**
   * Hand out the next revision number for a deployment. One `UPDATE` is what
   * makes this safe under concurrent publishes: two uploads can never receive
   * the same number, so they can never write into the same object prefix or
   * collide on (deploymentId, revision) after their objects are already stored.
   *
   * The number is allocated when the upload is prepared, so a build that never
   * commits leaves a gap rather than a reusable number.
   */
  reserveRevision = async (id: string): Promise<number> => {
    // `GREATEST(..., max + 1)` keeps the counter authoritative even for a row
    // whose counter lags its revisions (an import, or a row written before the
    // counter existed): a number that a revision already holds is never handed out.
    const nextRevision = sql`GREATEST(
      ${artifactDeployments.nextRevision},
      COALESCE((
        SELECT MAX(${artifactDeploymentRevisions.revision})
        FROM ${artifactDeploymentRevisions}
        WHERE ${artifactDeploymentRevisions.deploymentId} = ${artifactDeployments.id}
      ), 0) + 1
    ) + 1`;

    const [result] = await this.db
      .update(artifactDeployments)
      .set({ nextRevision, updatedAt: new Date() })
      .where(and(eq(artifactDeployments.id, id), this.ownership()))
      .returning({ nextRevision: artifactDeployments.nextRevision });

    if (!result) throw new Error(`Artifact deployment not found: ${id}`);

    return result.nextRevision - 1;
  };

  /** Revisions of a deployment owned by the caller, newest first. */
  listRevisions = async (deploymentId: string): Promise<ArtifactDeploymentRevisionItem[]> => {
    const rows = await this.db
      .select({ revision: artifactDeploymentRevisions })
      .from(artifactDeploymentRevisions)
      .innerJoin(
        artifactDeployments,
        eq(artifactDeploymentRevisions.deploymentId, artifactDeployments.id),
      )
      .where(and(eq(artifactDeploymentRevisions.deploymentId, deploymentId), this.ownership()))
      .orderBy(desc(artifactDeploymentRevisions.revision));

    return rows.map((row) => row.revision);
  };

  getRevision = async (
    deploymentId: string,
    revision: number,
  ): Promise<ArtifactDeploymentRevisionItem | undefined> => {
    const [result] = await this.db
      .select({ revision: artifactDeploymentRevisions })
      .from(artifactDeploymentRevisions)
      .innerJoin(
        artifactDeployments,
        eq(artifactDeploymentRevisions.deploymentId, artifactDeployments.id),
      )
      .where(
        and(
          eq(artifactDeploymentRevisions.deploymentId, deploymentId),
          eq(artifactDeploymentRevisions.revision, revision),
          this.ownership(),
        ),
      )
      .limit(1);

    return result?.revision;
  };
}

/**
 * Public read for the share page, which has no session and therefore no
 * user/workspace scope to filter by: the deployment id is the capability.
 * Only `published` deployments resolve, and only together with the revision
 * `currentRevision` points at — an unpublished or half-written deployment is
 * indistinguishable from a missing one.
 */
export const getPublishedDeployment = async (
  db: LobeChatDatabase,
  id: string,
): Promise<
  { deployment: ArtifactDeploymentItem; revision: ArtifactDeploymentRevisionItem } | undefined
> => {
  const [row] = await db
    .select({ deployment: artifactDeployments, revision: artifactDeploymentRevisions })
    .from(artifactDeployments)
    .innerJoin(
      artifactDeploymentRevisions,
      and(
        eq(artifactDeploymentRevisions.deploymentId, artifactDeployments.id),
        eq(artifactDeploymentRevisions.revision, artifactDeployments.currentRevision),
      ),
    )
    .where(and(eq(artifactDeployments.id, id), eq(artifactDeployments.status, 'published')))
    .limit(1);

  return row;
};
