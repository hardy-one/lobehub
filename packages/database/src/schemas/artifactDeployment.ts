import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';
import { users } from './user';
import { workspaces } from './workspace';

/**
 * One entry of a deployed revision's manifest: the object key inside the
 * deployment prefix, and what the upload wrote for it. `size` is in bytes and
 * is what the deploy limits are computed from, so it is the browser's count,
 * not the stored object's metadata.
 */
export interface ArtifactDeploymentFileInfo {
  contentType: string;
  size: number;
}

/** Every file a single deployed revision published, keyed by its object key. */
export type ArtifactDeploymentManifest = Record<string, ArtifactDeploymentFileInfo>;

/**
 * A published Artifact, addressed inside its conversation by
 * (userId, topicId, identifier). The row itself is stable across redeploys:
 * `currentRevision` advances while the older rows in
 * `artifact_deployment_revisions` stay readable.
 */
export const artifactDeployments = pgTable(
  'artifact_deployments',
  {
    /**
     * Externally generated nanoid, not a DB default: the id is minted before
     * the objects are uploaded, because the upload prefix is derived from it.
     */
    id: varchar('id', { length: 64 }).primaryKey().notNull(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    /** Conversation the Artifact belongs to; part of the address, not a scope. */
    topicId: text('topic_id').notNull(),

    /** Artifact identifier inside that topic, as written by the model. */
    identifier: text('identifier').notNull(),

    title: text('title'),

    /** How the deployment is rendered, e.g. 'html' | 'website'. */
    kind: text('kind').default('html').notNull(),

    /** Optional human-readable path segment used when building the share link. */
    slug: text('slug'),

    /** 'published' deployments are readable without a session; anything else is not. */
    status: text('status').default('published').notNull(),

    /** Revision currently served; must exist in `artifact_deployment_revisions`. */
    currentRevision: integer('current_revision').default(1).notNull(),

    /** File served for a directory request, relative to the deployment root. */
    entry: text('entry').default('index.html').notNull(),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('artifact_deployments_user_id_topic_id_identifier_unique').on(
      t.userId,
      t.topicId,
      t.identifier,
    ),
    index('artifact_deployments_user_id_idx').on(t.userId),
  ],
);

/**
 * Immutable upload record of one deploy. A revision is never updated in place —
 * a redeploy inserts the next `revision` and moves `artifact_deployments.currentRevision`,
 * so a share link always resolves to a complete manifest.
 */
export const artifactDeploymentRevisions = pgTable(
  'artifact_deployment_revisions',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    deploymentId: varchar('deployment_id', { length: 64 })
      .notNull()
      .references(() => artifactDeployments.id, { onDelete: 'cascade' }),

    /** 1-based, per deployment; (deploymentId, revision) is the unique key. */
    revision: integer('revision').notNull(),

    /** Object-store prefix the revision's files were written under. */
    objectPrefix: text('object_prefix').notNull(),

    /** What this revision published; see {@link ArtifactDeploymentManifest}. */
    manifest: jsonb('manifest').$type<ArtifactDeploymentManifest>().notNull(),

    /** Sum of the manifest sizes, kept for deploy limits and the usage UI. */
    totalBytes: integer('total_bytes').notNull(),

    fileCount: integer('file_count').notNull(),

    /** Build origin, e.g. which renderer produced the files. */
    source: text('source'),

    /** Digest of the published files; used to skip a redeploy of identical output. */
    contentHash: text('content_hash'),

    /** Server-side build duration in milliseconds. */
    buildMs: integer('build_ms'),

    /** Assistant message that triggered this revision. */
    messageId: text('message_id'),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('artifact_deployment_revisions_deployment_id_revision_unique').on(
      t.deploymentId,
      t.revision,
    ),
    index('artifact_deployment_revisions_deployment_id_idx').on(t.deploymentId),
  ],
);

export type NewArtifactDeployment = typeof artifactDeployments.$inferInsert;
export type ArtifactDeploymentItem = typeof artifactDeployments.$inferSelect;
export type NewArtifactDeploymentRevision = typeof artifactDeploymentRevisions.$inferInsert;
export type ArtifactDeploymentRevisionItem = typeof artifactDeploymentRevisions.$inferSelect;
