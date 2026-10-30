import type { LobeChatDatabase } from '@lobechat/database';
import { artifactSharePath, artifactShareUrl } from '@lobechat/utils/artifactShare';
import { TRPCError } from '@trpc/server';
import { sha256 } from 'js-sha256';
import { nanoid } from 'nanoid';

import {
  ArtifactDeploymentModel,
  getPublishedDeployment,
} from '@/database/models/artifactDeployment';
import { MessageModel } from '@/database/models/message';
import type {
  ArtifactDeploymentItem,
  ArtifactDeploymentManifest,
  ArtifactDeploymentRevisionItem,
} from '@/database/schemas';
import { appEnv } from '@/envs/app';
import { fileEnv } from '@/envs/file';
import { S3 } from '@/server/modules/S3';

/** Upload caps. They mirror the caps the workspace-HTML gatherer enforces before packing. */
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const MAX_FILES = 64;

const OBJECT_PREFIX_ROOT = 'artifacts';
const DEFAULT_ENTRY_PATH = 'index.html';
const HTML_CONTENT_TYPE = 'text/html; charset=utf-8';
const DEFAULT_CONTENT_TYPE = 'application/octet-stream';
/** A published Artifact is a single-file site: the entry is the whole document. */
const SINGLE_FILE_KIND = 'html';
const STATUS_PUBLISHED = 'published';
const STATUS_OFFLINE = 'offline';

/** One publish can record a revision exactly once; a second insert is a retry, not a new version. */
const REVISION_UNIQUE_CONSTRAINT = 'artifact_deployment_revisions_deployment_id_revision_unique';
/** (userId, topicId, identifier): two first publishes of one Artifact race on it. */
const DEPLOYMENT_UNIQUE_CONSTRAINT = 'artifact_deployments_user_id_topic_id_identifier_unique';

/** `uploadId` is the object prefix, so it carries the deployment and the revision it belongs to. */
const UPLOAD_ID_REGEX = /^artifacts\/([^/]+)\/v(\d+)$/;

const badRequest = (message: string) => new TRPCError({ code: 'BAD_REQUEST', message });

const notFound = (message: string) => new TRPCError({ code: 'NOT_FOUND', message });

const conflict = (message: string) => new TRPCError({ code: 'CONFLICT', message });

/**
 * Postgres unique violation, whether the driver reports it on the error or on its
 * cause. The constraint is checked where the driver names it, so a different
 * unique index on the same table is not read as the race this guards against.
 */
const isUniqueViolation = (error: unknown, constraint: string): boolean => {
  const candidate = error as {
    cause?: { code?: string; constraint?: string };
    code?: string;
    constraint?: string;
  };

  if ((candidate?.code ?? candidate?.cause?.code) !== '23505') return false;

  const name = candidate?.constraint ?? candidate?.cause?.constraint;

  return !name || name === constraint;
};

const objectPrefixOf = (deploymentId: string, revision: number) =>
  `${OBJECT_PREFIX_ROOT}/${deploymentId}/v${revision}`;

const toIsoString = (value: Date | string) => new Date(value).toISOString();

/**
 * Object keys are relative to the revision prefix, so a `..` segment would reach
 * outside the deployment that owns them. Backslashes are folded first, because a
 * Windows-shaped path would otherwise hide the escape from a `/`-only check.
 */
const normalizeObjectPath = (rawPath: string): string => {
  const normalized = rawPath
    .replaceAll('\\', '/')
    .replace(/^\/+/, '')
    .replaceAll(/\/{2,}/g, '/');
  const isSafe = normalized !== '' && !normalized.split('/').some((s) => s === '..' || s === '.');
  if (!isSafe) throw badRequest(`Invalid artifact path: ${rawPath}`);

  return normalized;
};

/**
 * Manifest keys arrive from the client, while the render route rebuilds them from
 * the request path. Canonicalizing on the way in is what keeps a look-up from
 * missing the file its own revision just published, and keeps a manifest entry
 * from naming an object outside the prefix.
 */
const normalizeManifest = (manifest: ArtifactDeploymentManifest): ArtifactDeploymentManifest =>
  Object.fromEntries(
    Object.entries(manifest).map(([path, info]) => [normalizeObjectPath(path), info]),
  );

const escapeRegExp = (value: string) => value.replaceAll(/[$()*+.?[\\\]^{|}]/g, '\\$&');

/** The closed `<lobeArtifact>` for one identifier, with the opening tag kept for its attributes. */
const closedArtifactRegex = (identifier: string) =>
  new RegExp(
    `(<lobeArtifact\\b[^>]*identifier="${escapeRegExp(identifier)}"[^>]*>)(?<content>[\\S\\s]*?)<\\/lobeArtifact>`,
  );

/** The same tag without requiring a closing tag, to tell "never closed" from "not present". */
const openArtifactRegex = (identifier: string) =>
  new RegExp(
    `<lobeArtifact\\b[^>]*identifier="${escapeRegExp(identifier)}"[^>]*>(?<content>[\\S\\s]*?)(?:<\\/lobeArtifact>|$)`,
  );

const CODE_FENCE_START_REGEX = /^\s*```[^\n]*(?:\n|$)/;
const CODE_FENCE_END_REGEX = /\n```\s*$/;

/** Models routinely wrap an Artifact's source in a markdown fence; the fence is not part of the page. */
const unwrapArtifactCodeBlock = (content: string) => {
  if (!CODE_FENCE_START_REGEX.test(content)) return content;

  return content.replace(CODE_FENCE_START_REGEX, '').replace(CODE_FENCE_END_REGEX, '');
};

type ArtifactSource =
  { html: string; status: 'ok'; title?: string } | { status: 'missing' } | { status: 'unclosed' };

const readArtifactSource = (content: string, identifier: string): ArtifactSource => {
  const closed = closedArtifactRegex(identifier).exec(content);
  if (!closed) {
    return openArtifactRegex(identifier).test(content)
      ? { status: 'unclosed' }
      : { status: 'missing' };
  }

  const title = /title="([^"]*)"/.exec(closed[1])?.[1];

  return {
    html: unwrapArtifactCodeBlock(closed.groups?.content ?? ''),
    status: 'ok',
    title: title || undefined,
  };
};

/**
 * Fingerprint of an Artifact's source, used to tell whether a deployment still
 * matches the conversation. `js-sha256` rather than `node:crypto`: a caller may
 * produce the hash it sends us in the browser, and both sides have to digest the
 * same string to the same value.
 */
const hashSource = (content: string) => sha256(content);

/**
 * Artifacts are served by the first-party render route, so their objects stay
 * private: the global `S3_SET_ACL` public-read switch is deliberately not read here.
 */
const createArtifactS3 = () =>
  new S3(fileEnv.S3_ACCESS_KEY_ID, fileEnv.S3_SECRET_ACCESS_KEY, fileEnv.S3_ENDPOINT, {
    bucket: fileEnv.S3_BUCKET,
    forcePathStyle: fileEnv.S3_ENABLE_PATH_STYLE,
    internalEndpoint: fileEnv.S3_INTERNAL_ENDPOINT,
    region: fileEnv.S3_REGION,
  });

let artifactS3: S3 | undefined;

/** Built on first use: database-only reads must not need object storage configured. */
const getArtifactS3 = (): S3 => (artifactS3 ??= createArtifactS3());

const publicUrlOf = (id: string) =>
  appEnv.APP_URL ? artifactShareUrl(appEnv.APP_URL, id) : artifactSharePath(id);

const assertWithinLimits = (files: ArtifactUploadFileInput[]) => {
  if (files.length === 0) throw badRequest('An artifact upload needs at least one file');
  if (files.length > MAX_FILES)
    throw badRequest(`An artifact upload carries at most ${MAX_FILES} files`);

  for (const file of files) {
    if (file.sizeBytes > MAX_FILE_BYTES)
      throw badRequest(`Artifact file ${file.path} exceeds the ${MAX_FILE_BYTES} byte limit`);
  }

  const totalBytes = files.reduce((total, file) => total + file.sizeBytes, 0);
  if (totalBytes > MAX_TOTAL_BYTES)
    throw badRequest(`Artifact upload exceeds the ${MAX_TOTAL_BYTES} byte limit`);
};

export interface ArtifactUploadFileInput {
  contentType: string;
  path: string;
  sizeBytes: number;
}

export interface ArtifactUploadFileTarget {
  headers: Record<string, string>;
  path: string;
  uploadUrl: string;
}

export interface PrepareArtifactUploadInput {
  files: ArtifactUploadFileInput[];
  identifier: string;
  /** How the published revision renders; recorded when the upload is committed. */
  kind: string;
  /**
   * Public slug the deploy asks for. Accepted here because the deploy call
   * carries it, but an upload is not a deployment yet, so nothing is persisted
   * until `commitUpload` — which takes it again for that reason.
   */
  requestedSlug?: string;
  /** Human-readable title; recorded when the upload is committed. */
  title?: string;
  topicId: string;
}

export interface PreparedArtifactUpload {
  deploymentId: string;
  files: ArtifactUploadFileTarget[];
  objectPrefix: string;
  revision: number;
  uploadId: string;
}

export interface CommitArtifactUploadInput {
  buildMs?: number;
  contentHash?: string;
  entry?: string;
  identifier: string;
  kind: string;
  manifest: ArtifactDeploymentManifest;
  messageId?: string;
  /**
   * Not part of the deploy call's own vocabulary, but the only place a slug can
   * be persisted: `prepareUpload` holds no state between the two calls.
   */
  requestedSlug?: string;
  source?: string;
  title?: string;
  topicId: string;
  uploadId: string;
}

export interface ArtifactCommitResult {
  id: string;
  latestRevisionNumber: number;
  publicUrl: string;
  slug: string | null;
  status: string;
}

export interface ExistingArtifactDeployment {
  id: string;
  identifier: string;
  kind: string;
  outdated: boolean;
  publicUrl: string;
  revision: number;
  status: 'offline' | 'published';
  title: string | null;
  updatedAt: string;
}

export interface ArtifactDeploymentListItem {
  currentRevision: number;
  id: string;
  identifier: string;
  kind: string;
  publicUrl: string;
  status: string;
  title: string | null;
  updatedAt: string;
}

export interface PublicArtifact {
  id: string;
  iframeSrc: string;
  title: string | null;
}

export interface ArtifactObject {
  /** Backed by a plain ArrayBuffer, which is what `Response` accepts as a body. */
  bytes: Uint8Array<ArrayBuffer>;
  contentType: string;
  /**
   * Whether this object is the deployment's entry file. The entry is served from
   * a stable URL that moves on every publish, so the route revalidates it
   * whatever file name it was published under.
   */
  isEntry: boolean;
}

/**
 * Private half of Artifact deployment: everything that needs a session, plus the
 * object-store writes behind it. Reads that the share page and the render route
 * need without a session live in `getPublicArtifact` / `readArtifactObject`.
 */
export class ArtifactDeploymentService {
  private readonly db: LobeChatDatabase;

  private readonly userId: string;

  private readonly workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private model = () => new ArtifactDeploymentModel(this.db, this.userId, this.workspaceId);

  private messages = () => new MessageModel(this.db, this.userId, this.workspaceId);

  private get s3(): S3 {
    return getArtifactS3();
  }

  /** What the conversation currently has deployed for one Artifact, if anything. */
  async getExisting({
    identifier,
    topicId,
  }: {
    identifier: string;
    topicId: string;
  }): Promise<ExistingArtifactDeployment | null> {
    const model = this.model();
    const deployment = await model.findByArtifact({ identifier, topicId });
    if (!deployment) return null;

    // Newest first.
    const revisions = await model.listRevisions(deployment.id);
    const outdated = await this.isOutdated(
      identifier,
      revisions.find((item) => item.revision === deployment.currentRevision),
      revisions.at(0),
    );

    return {
      id: deployment.id,
      identifier: deployment.identifier,
      kind: deployment.kind,
      outdated,
      publicUrl: publicUrlOf(deployment.id),
      revision: deployment.currentRevision,
      status: deployment.status === STATUS_PUBLISHED ? 'published' : 'offline',
      title: deployment.title,
      updatedAt: toIsoString(deployment.updatedAt),
    };
  }

  /**
   * Mint the deployment id and revision and hand back one presigned PUT per file.
   * No deployment or revision row is written: a build that fails after this point
   * must not leave the server with a deployment the conversation never published.
   * The revision number itself is reserved (and never handed out again), so a
   * failed build leaves a gap instead of a number that can be reused.
   */
  async prepareUpload(input: PrepareArtifactUploadInput): Promise<PreparedArtifactUpload> {
    const { files, identifier, topicId } = input;
    assertWithinLimits(files);

    const model = this.model();
    const existing = await model.findByArtifact({ identifier, topicId });
    const deploymentId = existing?.id ?? nanoid(21);
    // Allocate from the deployment's own high-water mark, not from what it serves:
    // restoring an older revision moves `currentRevision` back, and reusing the
    // number it now names would overwrite that revision's objects before the
    // (deploymentId, revision) unique index rejected the insert.
    const revision = existing ? await model.reserveRevision(existing.id) : 1;
    const objectPrefix = objectPrefixOf(deploymentId, revision);

    const targets = await Promise.all(
      files.map(async (file): Promise<ArtifactUploadFileTarget> => {
        const path = normalizeObjectPath(file.path);
        const { headers, url } = await this.s3.createPreSignedUpload(
          `${objectPrefix}/${path}`,
          file.sizeBytes,
        );

        return { headers: headers ?? {}, path, uploadUrl: url };
      }),
    );

    return { deploymentId, files: targets, objectPrefix, revision, uploadId: objectPrefix };
  }

  /**
   * Turn a finished upload into the served revision. The entry file is read back
   * from the store first — a presigned PUT only proves the browser was allowed to
   * write, not that it did — so a commit whose upload failed is rejected here
   * instead of publishing a broken site.
   */
  async commitUpload(input: CommitArtifactUploadInput): Promise<ArtifactCommitResult> {
    const {
      buildMs,
      contentHash,
      entry,
      identifier,
      kind,
      manifest,
      messageId,
      source,
      title,
      topicId,
      uploadId,
    } = input;

    const parsed = UPLOAD_ID_REGEX.exec(uploadId);
    if (!parsed) throw badRequest(`Malformed uploadId: ${uploadId}`);

    const deploymentId = parsed[1];
    const revision = Number(parsed[2]);
    const objectPrefix = objectPrefixOf(deploymentId, revision);

    const model = this.model();
    // `findById` is already scoped to the caller, so a hit is theirs. A hit on a
    // different address means this uploadId was minted for another Artifact.
    const existing = await model.findById(deploymentId);
    if (existing && (existing.topicId !== topicId || existing.identifier !== identifier))
      throw badRequest('This upload does not belong to the Artifact it was committed for');

    const entryPath = normalizeObjectPath(entry ?? existing?.entry ?? DEFAULT_ENTRY_PATH);
    await this.assertEntryUploaded(`${objectPrefix}/${entryPath}`, entryPath);

    const canonicalManifest = normalizeManifest(manifest);
    const manifestEntries = Object.entries(canonicalManifest);
    const slug = input.requestedSlug ?? existing?.slug ?? null;
    const resolvedTitle = title ?? existing?.title ?? null;

    // Created offline, then published once the revision row exists: in between,
    // `currentRevision` points at nothing, and a half-written deployment must stay
    // unreadable instead of serving an incomplete site. Two first publishes of the
    // same Artifact race on (userId, topicId, identifier): the loser is told to
    // retry instead of surfacing a unique-index failure as a server fault.
    if (!existing) {
      try {
        await model.create({
          currentRevision: revision,
          entry: entryPath,
          id: deploymentId,
          identifier,
          kind,
          nextRevision: revision + 1,
          slug,
          status: STATUS_OFFLINE,
          title: resolvedTitle,
          topicId,
        });
      } catch (error) {
        if (isUniqueViolation(error, DEPLOYMENT_UNIQUE_CONSTRAINT))
          throw conflict(
            'Another publish of this Artifact started at the same time. Reload it and publish again.',
          );

        throw error;
      }
    }

    try {
      await model.addRevision({
        buildMs,
        contentHash,
        deploymentId,
        fileCount: manifestEntries.length,
        manifest: canonicalManifest,
        messageId,
        objectPrefix,
        revision,
        source,
        totalBytes: manifestEntries.reduce((total, [, info]) => total + (info?.size ?? 0), 0),
      });
    } catch (error) {
      // The uploadId names the revision, and a revision records exactly one upload.
      // A row that already exists therefore belongs to an earlier attempt of this
      // same upload, so the retry is rejected rather than allowed to move the
      // served revision a second time.
      if (isUniqueViolation(error, REVISION_UNIQUE_CONSTRAINT))
        throw conflict(
          `Revision ${revision} has already been published. Reload the Artifact before publishing again.`,
        );

      throw error;
    }

    await model.update(deploymentId, {
      currentRevision: revision,
      entry: entryPath,
      kind,
      slug,
      status: STATUS_PUBLISHED,
      title: resolvedTitle,
    });

    return {
      id: deploymentId,
      latestRevisionNumber: revision,
      publicUrl: publicUrlOf(deploymentId),
      slug,
      status: STATUS_PUBLISHED,
    };
  }

  /**
   * Deploy the Artifact held by one assistant message as a single-file site. The
   * write path is the same one a client upload takes, so both produce an
   * identical layout and an identical entry check.
   */
  async publishArtifact({
    identifier,
    messageId,
    requestedSlug,
    topicId,
  }: {
    identifier: string;
    messageId: string;
    requestedSlug?: string;
    topicId: string;
  }): Promise<ArtifactCommitResult> {
    const message = await this.messages().findById(messageId);
    // `findById` already filters by owner, so not-found covers a foreign message too.
    if (!message) throw notFound(`Message not found: ${messageId}`);
    if (message.topicId !== topicId) throw badRequest('Message does not belong to this topic');

    const artifact = readArtifactSource(message.content ?? '', identifier);
    if (artifact.status === 'unclosed')
      throw badRequest(`Artifact "${identifier}" is not closed yet`);
    if (artifact.status === 'missing')
      throw badRequest(`Artifact "${identifier}" not found in message ${messageId}`);

    const body = Buffer.from(artifact.html, 'utf8');
    const manifest: ArtifactDeploymentManifest = {
      [DEFAULT_ENTRY_PATH]: { contentType: HTML_CONTENT_TYPE, size: body.byteLength },
    };

    const prepared = await this.prepareUpload({
      files: [
        {
          contentType: HTML_CONTENT_TYPE,
          path: DEFAULT_ENTRY_PATH,
          sizeBytes: body.byteLength,
        },
      ],
      identifier,
      kind: SINGLE_FILE_KIND,
      topicId,
    });

    await this.s3.uploadBuffer(
      `${prepared.objectPrefix}/${DEFAULT_ENTRY_PATH}`,
      body,
      HTML_CONTENT_TYPE,
    );

    return this.commitUpload({
      contentHash: hashSource(artifact.html),
      entry: DEFAULT_ENTRY_PATH,
      identifier,
      kind: SINGLE_FILE_KIND,
      manifest,
      messageId,
      requestedSlug,
      source: artifact.html,
      title: artifact.title,
      topicId,
      uploadId: prepared.uploadId,
    });
  }

  async listByTopic(topicId: string): Promise<ArtifactDeploymentListItem[]> {
    const rows = await this.model().listByTopic(topicId);

    return rows.map((row) => ({
      currentRevision: row.currentRevision,
      id: row.id,
      identifier: row.identifier,
      kind: row.kind,
      publicUrl: publicUrlOf(row.id),
      status: row.status,
      title: row.title,
      updatedAt: toIsoString(row.updatedAt),
    }));
  }

  /** Take the deployment off the public surface. Revisions and objects stay readable to its owner. */
  async unpublish({ id }: { id: string }): Promise<void> {
    await this.requireOwned(id);

    await this.model().update(id, { status: STATUS_OFFLINE });
  }

  /** Roll the served revision back or forward to one that this deployment actually has. */
  async setCurrentRevision({ id, revision }: { id: string; revision: number }): Promise<void> {
    const model = this.model();
    await this.requireOwned(id, model);

    if (!(await model.getRevision(id, revision)))
      throw badRequest(`Revision ${revision} does not exist for this deployment`);

    await model.update(id, { currentRevision: revision });
  }

  /**
   * Ownership is the model's scope: a row the caller cannot see is a row they
   * cannot act on, so a miss is reported as missing rather than as forbidden.
   */
  private async requireOwned(id: string, model = this.model()): Promise<ArtifactDeploymentItem> {
    const deployment = await model.findById(id);
    if (!deployment) throw notFound(`Artifact deployment not found: ${id}`);

    return deployment;
  }

  private async assertEntryUploaded(key: string, path: string) {
    try {
      await this.s3.getFileContent(key, 1);
    } catch {
      throw badRequest(`Artifact entry was not uploaded: ${path}`);
    }
  }

  /**
   * Whether the conversation has moved on from what is deployed: the source the
   * current revision was cut from, recomputed from the message as it stands now,
   * against the newest revision's recorded hash. Anything unresolvable (no
   * message id, no stored hash, a message that no longer carries the Artifact)
   * reads as "not outdated" rather than as an error.
   */
  private async isOutdated(
    identifier: string,
    current: ArtifactDeploymentRevisionItem | undefined,
    latest: ArtifactDeploymentRevisionItem | undefined,
  ): Promise<boolean> {
    if (!current?.messageId || !latest?.contentHash) return false;

    const message = await this.messages().findById(current.messageId);
    if (!message?.content) return false;

    const artifact = readArtifactSource(message.content, identifier);

    return artifact.status === 'ok' ? hashSource(artifact.html) !== latest.contentHash : false;
  }
}

/**
 * Self-hosted switch (`OSS_ENABLE_ARTIFACT_DEPLOYMENT`). Publishing and serving
 * are gated by the same value on purpose: an operator who turns it off is saying
 * this deployment does not host Artifact pages, so published links stop
 * resolving rather than staying reachable behind a closed switch. The objects
 * themselves stay in the bucket, so flipping the flag back restores them.
 */
export const isArtifactDeploymentEnabled = (): boolean => !!appEnv.OSS_ENABLE_ARTIFACT_DEPLOYMENT;

/**
 * Share-page read. It has no session and therefore no scope to filter by: the
 * deployment id is the capability, and only a published deployment resolves.
 */
export const getPublicArtifact = async (
  db: LobeChatDatabase,
  id: string,
): Promise<PublicArtifact | null> => {
  if (!isArtifactDeploymentEnabled()) return null;

  const found = await getPublishedDeployment(db, id);
  if (!found) return null;

  const { deployment } = found;

  return {
    id: deployment.id,
    // Name the entry file explicitly: a directory URL would be normalized by the
    // framework (trailing slash stripped), which breaks the relative asset paths
    // a `base: './'` build emits.
    iframeSrc: `/artifact-render/${deployment.id}/${deployment.entry}`,
    title: deployment.title,
  };
};

/**
 * Render-route read of one file of the published revision. Objects are private,
 * so this is the only way a browser reaches them.
 */
export const readArtifactObject = async (
  db: LobeChatDatabase,
  id: string,
  path: string,
): Promise<ArtifactObject | null> => {
  if (!isArtifactDeploymentEnabled()) return null;

  const found = await getPublishedDeployment(db, id);
  if (!found) return null;

  const { deployment, revision } = found;
  const requested = path?.trim() ?? '';
  // A directory request carries no file of its own; the deployment's entry answers it.
  const objectPath = normalizeObjectPath(
    requested === '' || requested === '/' ? deployment.entry : requested,
  );
  const contentType = revision.manifest?.[objectPath]?.contentType ?? DEFAULT_CONTENT_TYPE;

  try {
    const bytes = new Uint8Array(
      await getArtifactS3().getFileByteArray(`${revision.objectPrefix}/${objectPath}`),
    );

    // The entry is whatever the deployment says it is: `index.html` for the
    // first-party flow, but the upload contract takes any file name.
    return { bytes, contentType, isEntry: objectPath === deployment.entry };
  } catch {
    // A missing object is an ordinary 404 for a public reader, not a server fault.
    return null;
  }
};
