// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { marketDeploymentsRouter } from '@/business/server/lambda-routers/marketDeployments';

const service = vi.hoisted(() => ({
  commitUpload: vi.fn(),
  getExisting: vi.fn(),
  listByTopic: vi.fn(),
  prepareUpload: vi.fn(),
  publishArtifact: vi.fn(),
  setCurrentRevision: vi.fn(),
  unpublish: vi.fn(),
}));

const mocks = vi.hoisted(() => ({
  ArtifactDeploymentService: vi.fn(),
  isArtifactDeploymentEnabled: vi.fn(() => true),
  serverDB: {},
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(async () => mocks.serverDB),
}));

vi.mock('@/server/services/artifactDeployment', () => ({
  ArtifactDeploymentService: mocks.ArtifactDeploymentService,
  isArtifactDeploymentEnabled: mocks.isArtifactDeploymentEnabled,
}));

const caller = (ctx: Record<string, unknown> = { userId: 'user-1', workspaceId: 'ws-1' }) =>
  marketDeploymentsRouter.createCaller(ctx as any);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isArtifactDeploymentEnabled.mockReturnValue(true);
  mocks.ArtifactDeploymentService.mockImplementation(function () {
    return service;
  });
});

describe('marketDeploymentsRouter', () => {
  it('exposes the deployment contract the CLI and official client call', () => {
    expect(Object.keys(marketDeploymentsRouter._def.procedures).sort()).toEqual([
      'commitWorkspaceHtmlUpload',
      'getExisting',
      'listByTopic',
      'prepareWorkspaceHtmlUpload',
      'publishArtifact',
      'setCurrentRevision',
      'unpublish',
    ]);
  });

  it('scopes the service to the caller', async () => {
    await caller().getExisting({ identifier: 'artifact-1', topicId: 'topic-1' });

    expect(mocks.ArtifactDeploymentService).toHaveBeenCalledWith(mocks.serverDB, 'user-1', 'ws-1');
  });

  it('resolves the deployment of an artifact by identifier and topic', async () => {
    service.getExisting.mockResolvedValue({ id: 'dep-1' });

    await expect(
      caller().getExisting({ identifier: 'artifact-1', topicId: 'topic-1' }),
    ).resolves.toEqual({ id: 'dep-1' });
    expect(service.getExisting).toHaveBeenCalledWith({
      identifier: 'artifact-1',
      topicId: 'topic-1',
    });
  });

  it('lists a topic with the bare topic id', async () => {
    service.listByTopic.mockResolvedValue([]);

    await caller().listByTopic({ topicId: 'topic-1' });

    expect(service.listByTopic).toHaveBeenCalledWith('topic-1');
  });

  it('returns the upload plan for a workspace HTML upload', async () => {
    service.prepareUpload.mockResolvedValue({ uploadId: 'upload-1' });

    await expect(
      caller().prepareWorkspaceHtmlUpload({
        files: [{ contentType: 'text/html', path: 'index.html', sizeBytes: 12 }],
        identifier: 'artifact-1',
        kind: 'html',
        topicId: 'topic-1',
      }),
    ).resolves.toEqual({ uploadId: 'upload-1' });
    expect(service.prepareUpload).toHaveBeenCalledWith({
      files: [{ contentType: 'text/html', path: 'index.html', sizeBytes: 12 }],
      identifier: 'artifact-1',
      kind: 'html',
      topicId: 'topic-1',
    });
  });

  it('commits uploads, publishes, repoints the revision and unpublishes', async () => {
    const router = caller();

    await router.commitWorkspaceHtmlUpload({
      identifier: 'artifact-1',
      kind: 'react',
      manifest: { 'index.html': { contentType: 'text/html', size: 12 } },
      topicId: 'topic-1',
      uploadId: 'upload-1',
    });
    await router.publishArtifact({
      identifier: 'artifact-1',
      messageId: 'msg-1',
      topicId: 'topic-1',
    });
    await router.setCurrentRevision({ id: 'dep-1', revision: 2 });
    await router.unpublish({ id: 'dep-1' });

    expect(service.commitUpload).toHaveBeenCalledWith(
      expect.objectContaining({ uploadId: 'upload-1' }),
    );
    expect(service.publishArtifact).toHaveBeenCalledWith({
      identifier: 'artifact-1',
      messageId: 'msg-1',
      topicId: 'topic-1',
    });
    expect(service.setCurrentRevision).toHaveBeenCalledWith({ id: 'dep-1', revision: 2 });
    expect(service.unpublish).toHaveBeenCalledWith({ id: 'dep-1' });
  });

  it('refuses every procedure while the self-hosted switch is off', async () => {
    mocks.isArtifactDeploymentEnabled.mockReturnValue(false);

    await expect(
      caller().getExisting({ identifier: 'artifact-1', topicId: 'topic-1' }),
    ).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });

    expect(service.getExisting).not.toHaveBeenCalled();
  });
});
