// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { sha256 } from 'js-sha256';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const addRevision = vi.fn();
const create = vi.fn();
const findByArtifact = vi.fn();
const findById = vi.fn();
const getRevision = vi.fn();
const listByTopic = vi.fn();
const listRevisions = vi.fn();
const update = vi.fn();

const findMessageById = vi.fn();

const getPublishedDeployment = vi.fn();

const createPreSignedUpload = vi.fn();
const getFileByteArray = vi.fn();
const getFileContent = vi.fn();
const uploadBuffer = vi.fn();

vi.mock('nanoid', () => ({ nanoid: () => 'generated-deployment-id' }));

// Mutable so a test can exercise the disabled deployment without a second module
// graph: the gate reads the env value on every call.
const { appEnvMock } = vi.hoisted(() => ({
  appEnvMock: {
    APP_URL: 'https://app.test',
    OSS_ENABLE_ARTIFACT_DEPLOYMENT: true as boolean | undefined,
  },
}));

vi.mock('@/envs/app', () => ({ appEnv: appEnvMock }));

vi.mock('@/envs/file', () => ({
  fileEnv: {
    S3_ACCESS_KEY_ID: 'access-key',
    S3_BUCKET: 'bucket',
    S3_ENABLE_PATH_STYLE: false,
    S3_ENDPOINT: 'https://s3.test',
    S3_INTERNAL_ENDPOINT: undefined,
    S3_REGION: 'us-east-1',
    S3_SECRET_ACCESS_KEY: 'secret-key',
  },
}));

vi.mock('@/database/models/artifactDeployment', () => ({
  ArtifactDeploymentModel: vi.fn(function () {
    return {
      addRevision,
      create,
      findByArtifact,
      findById,
      getRevision,
      listByTopic,
      listRevisions,
      update,
    };
  }),
  getPublishedDeployment,
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn(function () {
    return { findById: findMessageById };
  }),
}));

vi.mock('@/server/modules/S3', () => ({
  S3: vi.fn(function () {
    return { createPreSignedUpload, getFileByteArray, getFileContent, uploadBuffer };
  }),
}));

// Imported after the mocks so the constructors pull in the stubs.
const { ArtifactDeploymentService, getPublicArtifact, readArtifactObject } =
  await import('../index');

const db = {} as LobeChatDatabase;

const deploymentRow = (overrides: Record<string, unknown> = {}) => ({
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  currentRevision: 1,
  entry: 'index.html',
  id: 'dep_1',
  identifier: 'art_1',
  kind: 'html',
  slug: null,
  status: 'published',
  title: 'Demo',
  topicId: 'tpc_1',
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  userId: 'user_1',
  workspaceId: null,
  ...overrides,
});

const revisionRow = (overrides: Record<string, unknown> = {}) => ({
  buildMs: null,
  contentHash: null,
  createdAt: new Date('2026-01-02T00:00:00.000Z'),
  deploymentId: 'dep_1',
  fileCount: 1,
  id: 'rev_1',
  manifest: { 'index.html': { contentType: 'text/html; charset=utf-8', size: 12 } },
  messageId: null,
  objectPrefix: 'artifacts/dep_1/v1',
  revision: 1,
  source: null,
  totalBytes: 12,
  ...overrides,
});

/** A message whose Artifact wraps its source in a markdown fence. */
const fencedArtifactMessage = (
  html: string,
  attributes = 'identifier="art_1" type="html" title="Demo"',
) => ({
  content: `Here you go:\n\n<lobeArtifact ${attributes}>\n\`\`\`html\n${html}\n\`\`\`\n</lobeArtifact>`,
  topicId: 'tpc_1',
});

const service = () => new ArtifactDeploymentService(db, 'user_1');

beforeEach(() => {
  vi.clearAllMocks();

  appEnvMock.OSS_ENABLE_ARTIFACT_DEPLOYMENT = true;

  addRevision.mockImplementation((values) => Promise.resolve(values));
  create.mockImplementation((values) => Promise.resolve(values));
  createPreSignedUpload.mockResolvedValue({
    headers: { 'content-type': 'text/html' },
    url: 'https://s3.test/put',
  });
  findByArtifact.mockResolvedValue(undefined);
  findById.mockResolvedValue(undefined);
  findMessageById.mockResolvedValue(undefined);
  getFileByteArray.mockResolvedValue(new Uint8Array([1, 2, 3]));
  getFileContent.mockResolvedValue('<html>');
  getPublishedDeployment.mockResolvedValue(undefined);
  getRevision.mockResolvedValue(revisionRow());
  listByTopic.mockResolvedValue([]);
  listRevisions.mockResolvedValue([]);
  update.mockResolvedValue(undefined);
  uploadBuffer.mockResolvedValue(undefined);
});

describe('ArtifactDeploymentService.prepareUpload', () => {
  it('sizes the presigned targets from the keys the revision will be served from', async () => {
    findByArtifact.mockResolvedValue(deploymentRow({ currentRevision: 3, id: 'dep_3' }));

    const prepared = await service().prepareUpload({
      files: [
        { contentType: 'text/html', path: '/index.html', sizeBytes: 12 },
        { contentType: 'text/css', path: 'assets/app.css', sizeBytes: 20 },
      ],
      identifier: 'art_1',
      kind: 'website',
      topicId: 'tpc_1',
    });

    expect(prepared).toEqual({
      deploymentId: 'dep_3',
      files: [
        {
          headers: { 'content-type': 'text/html' },
          path: 'index.html',
          uploadUrl: 'https://s3.test/put',
        },
        {
          headers: { 'content-type': 'text/html' },
          path: 'assets/app.css',
          uploadUrl: 'https://s3.test/put',
        },
      ],
      objectPrefix: 'artifacts/dep_3/v4',
      revision: 4,
      uploadId: 'artifacts/dep_3/v4',
    });
    // Leading slashes are stripped, so the key matches the one the render route rebuilds.
    expect(createPreSignedUpload).toHaveBeenCalledWith('artifacts/dep_3/v4/index.html', 12);
    expect(createPreSignedUpload).toHaveBeenCalledWith('artifacts/dep_3/v4/assets/app.css', 20);
  });

  it('mints a deployment and starts at revision 1 without writing anything', async () => {
    findByArtifact.mockResolvedValue(undefined);

    const prepared = await service().prepareUpload({
      files: [{ contentType: 'text/html', path: 'index.html', sizeBytes: 12 }],
      identifier: 'art_1',
      kind: 'website',
      topicId: 'tpc_1',
    });

    expect(prepared).toEqual({
      deploymentId: 'generated-deployment-id',
      files: [
        {
          headers: { 'content-type': 'text/html' },
          path: 'index.html',
          uploadUrl: 'https://s3.test/put',
        },
      ],
      objectPrefix: 'artifacts/generated-deployment-id/v1',
      revision: 1,
      uploadId: 'artifacts/generated-deployment-id/v1',
    });
    // A build that dies after this point must not leave a half-published deployment.
    expect(create).not.toHaveBeenCalled();
    expect(addRevision).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects an upload that breaks a deploy limit', async () => {
    findByArtifact.mockResolvedValue(undefined);
    const serviceUnderTest = service();

    await expect(
      serviceUnderTest.prepareUpload({
        files: Array.from({ length: 65 }, () => ({
          contentType: 'text/html',
          path: 'index.html',
          sizeBytes: 1,
        })),
        identifier: 'art_1',
        kind: 'html',
        topicId: 'tpc_1',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    await expect(
      serviceUnderTest.prepareUpload({
        files: [{ contentType: 'text/html', path: 'big.html', sizeBytes: 50 * 1024 * 1024 + 1 }],
        identifier: 'art_1',
        kind: 'html',
        topicId: 'tpc_1',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    await expect(
      serviceUnderTest.prepareUpload({
        files: [
          { contentType: 'text/html', path: 'a.html', sizeBytes: 40 * 1024 * 1024 },
          { contentType: 'text/html', path: 'b.html', sizeBytes: 40 * 1024 * 1024 },
        ],
        identifier: 'art_1',
        kind: 'html',
        topicId: 'tpc_1',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    expect(createPreSignedUpload).not.toHaveBeenCalled();
  });

  it('refuses a path that would escape the deployment prefix', async () => {
    findByArtifact.mockResolvedValue(undefined);

    await expect(
      service().prepareUpload({
        files: [{ contentType: 'text/html', path: '../../other/index.html', sizeBytes: 12 }],
        identifier: 'art_1',
        kind: 'html',
        topicId: 'tpc_1',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('ArtifactDeploymentService.commitUpload', () => {
  it('rejects a commit whose entry file was never uploaded', async () => {
    findById.mockResolvedValue(deploymentRow());
    getFileContent.mockRejectedValue(new Error('NoSuchKey'));

    await expect(
      service().commitUpload({
        identifier: 'art_1',
        kind: 'html',
        manifest: { 'index.html': { contentType: 'text/html', size: 12 } },
        topicId: 'tpc_1',
        uploadId: 'artifacts/dep_1/v2',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    expect(addRevision).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects an uploadId minted for a different Artifact', async () => {
    findById.mockResolvedValue(deploymentRow({ identifier: 'someone-elses-artifact' }));

    await expect(
      service().commitUpload({
        identifier: 'art_1',
        kind: 'html',
        manifest: { 'index.html': { contentType: 'text/html', size: 12 } },
        topicId: 'tpc_1',
        uploadId: 'artifacts/dep_1/v2',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    expect(getFileContent).not.toHaveBeenCalled();
    expect(addRevision).not.toHaveBeenCalled();
  });

  it('canonicalizes entry and manifest paths so the render route finds them again', async () => {
    findById.mockResolvedValue(deploymentRow());

    await service().commitUpload({
      entry: '/index.html',
      identifier: 'art_1',
      kind: 'html',
      manifest: { '/index.html': { contentType: 'text/html; charset=utf-8', size: 12 } },
      topicId: 'tpc_1',
      uploadId: 'artifacts/dep_1/v2',
    });

    expect(getFileContent).toHaveBeenCalledWith('artifacts/dep_1/v2/index.html', 1);
    expect(addRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        manifest: { 'index.html': { contentType: 'text/html; charset=utf-8', size: 12 } },
      }),
    );
    expect(update).toHaveBeenCalledWith(
      'dep_1',
      expect.objectContaining({ currentRevision: 2, entry: 'index.html' }),
    );
  });

  it('records the revision, publishes the deployment and reports the share url', async () => {
    findById.mockResolvedValue(deploymentRow());

    const result = await service().commitUpload({
      contentHash: 'source-hash',
      entry: 'index.html',
      identifier: 'art_1',
      kind: 'html',
      manifest: { 'index.html': { contentType: 'text/html; charset=utf-8', size: 12 } },
      messageId: 'msg_1',
      source: '<html>',
      topicId: 'tpc_1',
      uploadId: 'artifacts/dep_1/v2',
    });

    expect(getFileContent).toHaveBeenCalledWith('artifacts/dep_1/v2/index.html', 1);
    expect(addRevision).toHaveBeenCalledWith({
      buildMs: undefined,
      contentHash: 'source-hash',
      deploymentId: 'dep_1',
      fileCount: 1,
      manifest: { 'index.html': { contentType: 'text/html; charset=utf-8', size: 12 } },
      messageId: 'msg_1',
      objectPrefix: 'artifacts/dep_1/v2',
      revision: 2,
      source: '<html>',
      totalBytes: 12,
    });
    expect(update).toHaveBeenCalledWith('dep_1', {
      currentRevision: 2,
      entry: 'index.html',
      kind: 'html',
      slug: null,
      status: 'published',
      title: 'Demo',
    });
    expect(result).toEqual({
      id: 'dep_1',
      latestRevisionNumber: 2,
      publicUrl: 'https://app.test/share/artifact/dep_1',
      slug: null,
      status: 'published',
    });
  });

  it('creates the deployment for a commit whose upload started one', async () => {
    findById.mockResolvedValue(undefined);

    await service().commitUpload({
      entry: 'index.html',
      identifier: 'art_1',
      kind: 'html',
      manifest: { 'index.html': { contentType: 'text/html', size: 12 } },
      title: 'Fresh',
      topicId: 'tpc_1',
      uploadId: 'artifacts/generated-deployment-id/v1',
    });

    // Offline until its revision exists, so a failure in between cannot serve a partial site.
    expect(create).toHaveBeenCalledWith({
      currentRevision: 1,
      entry: 'index.html',
      id: 'generated-deployment-id',
      identifier: 'art_1',
      kind: 'html',
      slug: null,
      status: 'offline',
      title: 'Fresh',
      topicId: 'tpc_1',
    });
    expect(update).toHaveBeenCalledWith(
      'generated-deployment-id',
      expect.objectContaining({ currentRevision: 1, status: 'published' }),
    );
  });
});

describe('ArtifactDeploymentService.publishArtifact', () => {
  it('publishes the fenced Artifact source as a single-file site', async () => {
    findMessageById.mockResolvedValue(fencedArtifactMessage('<!doctype html><h1>hi</h1>'));
    findByArtifact.mockResolvedValue(undefined);
    findById.mockResolvedValue(undefined);

    const result = await service().publishArtifact({
      identifier: 'art_1',
      messageId: 'msg_1',
      topicId: 'tpc_1',
    });

    expect(uploadBuffer).toHaveBeenCalledTimes(1);
    const [key, body, contentType] = uploadBuffer.mock.calls[0];
    expect(key).toBe('artifacts/generated-deployment-id/v1/index.html');
    expect(contentType).toBe('text/html; charset=utf-8');
    // The markdown fence is unwrapped, the Artifact's own tags are not part of the page.
    expect(body.toString('utf8')).toBe('<!doctype html><h1>hi</h1>');

    expect(addRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        contentHash: sha256('<!doctype html><h1>hi</h1>'),
        messageId: 'msg_1',
        source: '<!doctype html><h1>hi</h1>',
      }),
    );
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Demo' }));
    expect(result.publicUrl).toBe('https://app.test/share/artifact/generated-deployment-id');
  });

  it('rejects an Artifact whose tag was never closed', async () => {
    findMessageById.mockResolvedValue({
      content: '<lobeArtifact identifier="art_1" type="html">\n<html>',
      topicId: 'tpc_1',
    });

    await expect(
      service().publishArtifact({ identifier: 'art_1', messageId: 'msg_1', topicId: 'tpc_1' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    expect(uploadBuffer).not.toHaveBeenCalled();
    expect(addRevision).not.toHaveBeenCalled();
  });

  it('rejects a message that carries no such Artifact, or belongs to another topic', async () => {
    findMessageById.mockResolvedValue(
      fencedArtifactMessage('<h1>hi</h1>', 'identifier="art_other" type="html"'),
    );

    await expect(
      service().publishArtifact({ identifier: 'art_1', messageId: 'msg_1', topicId: 'tpc_1' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    findMessageById.mockResolvedValue(fencedArtifactMessage('<h1>hi</h1>'));

    await expect(
      service().publishArtifact({ identifier: 'art_1', messageId: 'msg_1', topicId: 'tpc_other' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    expect(uploadBuffer).not.toHaveBeenCalled();
  });
});

describe('ArtifactDeploymentService.getExisting', () => {
  it('reports a deployment as outdated when the conversation moved past the deployed source', async () => {
    findByArtifact.mockResolvedValue(deploymentRow({ currentRevision: 2 }));
    listRevisions.mockResolvedValue([
      revisionRow({ contentHash: sha256('<h1>deployed</h1>'), messageId: 'msg_2', revision: 2 }),
      revisionRow({ contentHash: 'older', messageId: 'msg_1', revision: 1 }),
    ]);
    findMessageById.mockResolvedValue({
      content: '<lobeArtifact identifier="art_1" type="html"><h1>edited since</h1></lobeArtifact>',
      topicId: 'tpc_1',
    });

    const existing = await service().getExisting({ identifier: 'art_1', topicId: 'tpc_1' });

    expect(existing).toEqual({
      id: 'dep_1',
      identifier: 'art_1',
      kind: 'html',
      outdated: true,
      publicUrl: 'https://app.test/share/artifact/dep_1',
      revision: 2,
      status: 'published',
      title: 'Demo',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
  });

  it('falls back to "not outdated" when the revision has no message to compare against', async () => {
    findByArtifact.mockResolvedValue(deploymentRow());
    listRevisions.mockResolvedValue([revisionRow({ contentHash: sha256('<h1>x</h1>') })]);

    const existing = await service().getExisting({ identifier: 'art_1', topicId: 'tpc_1' });

    expect(existing?.outdated).toBe(false);
    expect(findMessageById).not.toHaveBeenCalled();
  });

  it('reports no deployment when the topic never published one', async () => {
    findByArtifact.mockResolvedValue(undefined);

    expect(await service().getExisting({ identifier: 'art_1', topicId: 'tpc_1' })).toBeNull();
  });
});

describe('ArtifactDeploymentService.unpublish and setCurrentRevision', () => {
  it('takes a published deployment offline and rolls the served revision', async () => {
    findById.mockResolvedValue(deploymentRow());

    await service().unpublish({ id: 'dep_1' });
    expect(update).toHaveBeenCalledWith('dep_1', { status: 'offline' });

    await service().setCurrentRevision({ id: 'dep_1', revision: 3 });
    expect(update).toHaveBeenCalledWith('dep_1', { currentRevision: 3 });
  });

  it('refuses a deployment the caller does not own, and an unknown revision', async () => {
    findById.mockResolvedValue(undefined);

    await expect(service().unpublish({ id: 'dep_foreign' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    findById.mockResolvedValue(deploymentRow());
    getRevision.mockResolvedValue(undefined);

    await expect(service().setCurrentRevision({ id: 'dep_1', revision: 9 })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(update).not.toHaveBeenCalled();
  });
});

describe('readArtifactObject', () => {
  it('serves the entry file for a directory request and labels it from the manifest', async () => {
    getPublishedDeployment.mockResolvedValue({
      deployment: deploymentRow(),
      revision: revisionRow(),
    });

    const result = await readArtifactObject(db, 'dep_1', '');

    expect(getFileByteArray).toHaveBeenCalledWith('artifacts/dep_1/v1/index.html');
    expect(result).toEqual({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: 'text/html; charset=utf-8',
    });
  });

  it('refuses a path that would escape the published prefix', async () => {
    getPublishedDeployment.mockResolvedValue({
      deployment: deploymentRow(),
      revision: revisionRow(),
    });

    for (const path of ['../../etc/passwd', '..\\..\\secrets.txt', '/../other/index.html']) {
      await expect(readArtifactObject(db, 'dep_1', path)).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
    }

    expect(getFileByteArray).not.toHaveBeenCalled();
  });

  it('returns null for an unpublished deployment or a file the revision never published', async () => {
    getPublishedDeployment.mockResolvedValue(undefined);
    expect(await readArtifactObject(db, 'dep_1', 'index.html')).toBeNull();

    getPublishedDeployment.mockResolvedValue({
      deployment: deploymentRow(),
      revision: revisionRow(),
    });
    getFileByteArray.mockRejectedValue(new Error('NoSuchKey'));
    expect(await readArtifactObject(db, 'dep_1', 'missing.html')).toBeNull();
  });

  it('reads nothing while the deployment has Artifact hosting switched off', async () => {
    appEnvMock.OSS_ENABLE_ARTIFACT_DEPLOYMENT = false;
    getPublishedDeployment.mockResolvedValue({
      deployment: deploymentRow(),
      revision: revisionRow(),
    });

    expect(await readArtifactObject(db, 'dep_1', 'index.html')).toBeNull();
    expect(getFileByteArray).not.toHaveBeenCalled();
  });
});

describe('getPublicArtifact', () => {
  it('points the share page at the entry file, not the deployment directory', async () => {
    getPublishedDeployment.mockResolvedValue({
      deployment: deploymentRow(),
      revision: revisionRow(),
    });

    // A directory URL would be normalized by the framework (trailing slash
    // stripped), which breaks the relative asset paths of the built page.
    expect(await getPublicArtifact(db, 'dep_1')).toEqual({
      id: 'dep_1',
      iframeSrc: '/artifact-render/dep_1/index.html',
      title: 'Demo',
    });
  });

  it('returns null when the deployment is not published', async () => {
    getPublishedDeployment.mockResolvedValue(undefined);

    expect(await getPublicArtifact(db, 'dep_1')).toBeNull();
  });

  it('resolves nothing while the deployment has Artifact hosting switched off', async () => {
    appEnvMock.OSS_ENABLE_ARTIFACT_DEPLOYMENT = false;
    getPublishedDeployment.mockResolvedValue({
      deployment: deploymentRow(),
      revision: revisionRow(),
    });

    // A closed switch must not leave published links reachable.
    expect(await getPublicArtifact(db, 'dep_1')).toBeNull();
  });
});
