// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { artifactDeploymentRevisions, artifactDeployments, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { ArtifactDeploymentModel, getPublishedDeployment } from '../artifactDeployment';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'artifact-deploy-user';
const otherUserId = 'artifact-deploy-user-2';
const workspaceId = 'artifact-deploy-workspace';
const topicId = 'artifact-deploy-topic';
const identifier = 'index';

const deploymentModel = new ArtifactDeploymentModel(serverDB, userId);
const otherDeploymentModel = new ArtifactDeploymentModel(serverDB, otherUserId);

const revisionValues = (deploymentId: string, revision: number) => ({
  deploymentId,
  fileCount: 1,
  manifest: { 'index.html': { contentType: 'text/html', size: 1024 } },
  objectPrefix: `artifacts/${deploymentId}/r${revision}`,
  revision,
  totalBytes: 1024,
});

const createDeployment = (model: ArtifactDeploymentModel, id: string, overrides = {}) =>
  model.create({ id, identifier, topicId, ...overrides });

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(workspaces).values({
    id: workspaceId,
    name: 'Artifact Deployment Workspace',
    primaryOwnerId: userId,
    slug: workspaceId,
  });
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('ArtifactDeploymentModel', () => {
  describe('create', () => {
    it('applies the column defaults and binds the row to the constructor scope', async () => {
      const result = await createDeployment(deploymentModel, 'dep-defaults');

      expect(result).toMatchObject({
        currentRevision: 1,
        entry: 'index.html',
        identifier,
        kind: 'html',
        status: 'published',
        topicId,
        userId,
        workspaceId: null,
      });
      expect(result.createdAt).toBeInstanceOf(Date);
    });

    it('binds a workspace deployment to that workspace', async () => {
      const workspaceModel = new ArtifactDeploymentModel(serverDB, userId, workspaceId);

      const result = await createDeployment(workspaceModel, 'dep-workspace');

      expect(result.workspaceId).toBe(workspaceId);
    });
  });

  describe('findByArtifact', () => {
    it('resolves the caller’s own deployment', async () => {
      await createDeployment(deploymentModel, 'dep-find');

      const result = await deploymentModel.findByArtifact({ identifier, topicId });

      expect(result?.id).toBe('dep-find');
    });

    it('does not resolve another user’s deployment in the same topic', async () => {
      await createDeployment(otherDeploymentModel, 'dep-other-user');

      const result = await deploymentModel.findByArtifact({ identifier, topicId });

      expect(result).toBeUndefined();
    });

    it('does not resolve a workspace deployment from a personal scope', async () => {
      const workspaceModel = new ArtifactDeploymentModel(serverDB, userId, workspaceId);
      await createDeployment(workspaceModel, 'dep-ws-scope');

      expect(await deploymentModel.findByArtifact({ identifier, topicId })).toBeUndefined();
      expect(await workspaceModel.findByArtifact({ identifier, topicId })).toMatchObject({
        id: 'dep-ws-scope',
      });
    });

    it('returns undefined for an unknown identifier', async () => {
      await createDeployment(deploymentModel, 'dep-known');

      expect(
        await deploymentModel.findByArtifact({ identifier: 'other', topicId }),
      ).toBeUndefined();
      expect(
        await deploymentModel.findByArtifact({ identifier, topicId: 'other-topic' }),
      ).toBeUndefined();
    });
  });

  describe('findById', () => {
    it('returns the caller’s own deployment', async () => {
      await createDeployment(deploymentModel, 'dep-by-id');

      expect(await deploymentModel.findById('dep-by-id')).toMatchObject({ id: 'dep-by-id' });
    });

    it('does not leak another user’s deployment', async () => {
      await createDeployment(otherDeploymentModel, 'dep-by-id-other');

      expect(await deploymentModel.findById('dep-by-id-other')).toBeUndefined();
    });
  });

  describe('listByTopic', () => {
    it('lists only the caller’s deployments of that topic, newest first', async () => {
      await serverDB.insert(artifactDeployments).values([
        {
          id: 'dep-old',
          identifier: 'a',
          topicId,
          userId,
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
        {
          id: 'dep-new',
          identifier: 'b',
          topicId,
          userId,
          createdAt: new Date('2026-02-01T00:00:00Z'),
        },
        { id: 'dep-other', identifier: 'c', topicId, userId: otherUserId },
        { id: 'dep-other-topic', identifier: 'd', topicId: 'another-topic', userId },
      ]);

      const result = await deploymentModel.listByTopic(topicId);

      expect(result.map((row) => row.id)).toEqual(['dep-new', 'dep-old']);
    });
  });

  describe('update', () => {
    it('patches the deployment’s own fields', async () => {
      await createDeployment(deploymentModel, 'dep-update');

      const result = await deploymentModel.update('dep-update', {
        currentRevision: 2,
        title: 'Renamed',
      });

      expect(result).toMatchObject({ currentRevision: 2, title: 'Renamed' });
    });

    it('ignores ownership columns in the patch', async () => {
      await createDeployment(deploymentModel, 'dep-update-scope');

      const result = await deploymentModel.update('dep-update-scope', {
        identifier: 'renamed',
        userId: otherUserId,
        workspaceId,
      });

      expect(result).toMatchObject({ identifier: 'renamed', userId, workspaceId: null });
    });

    it('returns undefined for another user’s deployment', async () => {
      await createDeployment(otherDeploymentModel, 'dep-update-other');

      const result = await deploymentModel.update('dep-update-other', { title: 'Hacked' });

      expect(result).toBeUndefined();
      expect(await otherDeploymentModel.findById('dep-update-other')).toMatchObject({
        title: null,
      });
    });
  });

  describe('remove', () => {
    it('deletes the caller’s deployment together with its revisions', async () => {
      await createDeployment(deploymentModel, 'dep-remove');
      await deploymentModel.addRevision(revisionValues('dep-remove', 1));

      await deploymentModel.remove('dep-remove');

      expect(await deploymentModel.findById('dep-remove')).toBeUndefined();
      expect(
        await serverDB
          .select()
          .from(artifactDeploymentRevisions)
          .where(eq(artifactDeploymentRevisions.deploymentId, 'dep-remove')),
      ).toHaveLength(0);
    });

    it('leaves another user’s deployment in place', async () => {
      await createDeployment(otherDeploymentModel, 'dep-remove-other');

      await deploymentModel.remove('dep-remove-other');

      expect(await otherDeploymentModel.findById('dep-remove-other')).toBeDefined();
    });
  });

  describe('addRevision', () => {
    it('stores the revision manifest', async () => {
      await createDeployment(deploymentModel, 'dep-revision');

      const result = await deploymentModel.addRevision(revisionValues('dep-revision', 1));

      expect(result).toMatchObject({
        deploymentId: 'dep-revision',
        fileCount: 1,
        manifest: { 'index.html': { contentType: 'text/html', size: 1024 } },
        revision: 1,
        totalBytes: 1024,
      });
    });

    it('rejects a revision number that already exists for the deployment', async () => {
      await createDeployment(deploymentModel, 'dep-revision-conflict');
      await deploymentModel.addRevision(revisionValues('dep-revision-conflict', 1));

      await expect(
        deploymentModel.addRevision(revisionValues('dep-revision-conflict', 1)),
      ).rejects.toThrow();

      expect(await deploymentModel.listRevisions('dep-revision-conflict')).toHaveLength(1);
    });

    it('accepts the same revision number for a different deployment', async () => {
      await createDeployment(deploymentModel, 'dep-revision-a');
      await createDeployment(deploymentModel, 'dep-revision-b', { identifier: 'second' });

      await deploymentModel.addRevision(revisionValues('dep-revision-a', 1));
      await deploymentModel.addRevision(revisionValues('dep-revision-b', 1));

      expect(await deploymentModel.listRevisions('dep-revision-b')).toHaveLength(1);
    });
  });

  describe('listRevisions', () => {
    it('returns the deployment’s revisions newest first', async () => {
      await createDeployment(deploymentModel, 'dep-list-revisions');
      await deploymentModel.addRevision(revisionValues('dep-list-revisions', 1));
      await deploymentModel.addRevision(revisionValues('dep-list-revisions', 2));

      const result = await deploymentModel.listRevisions('dep-list-revisions');

      expect(result.map((row) => row.revision)).toEqual([2, 1]);
    });

    it('does not return revisions of another user’s deployment', async () => {
      await createDeployment(otherDeploymentModel, 'dep-list-revisions-other');
      await otherDeploymentModel.addRevision(revisionValues('dep-list-revisions-other', 1));

      expect(await deploymentModel.listRevisions('dep-list-revisions-other')).toEqual([]);
    });
  });

  describe('getRevision', () => {
    it('returns the requested revision', async () => {
      await createDeployment(deploymentModel, 'dep-get-revision');
      await deploymentModel.addRevision(revisionValues('dep-get-revision', 1));
      await deploymentModel.addRevision(revisionValues('dep-get-revision', 2));

      const result = await deploymentModel.getRevision('dep-get-revision', 1);

      expect(result?.revision).toBe(1);
      expect(result?.objectPrefix).toBe('artifacts/dep-get-revision/r1');
    });

    it('returns undefined for a revision that does not exist', async () => {
      await createDeployment(deploymentModel, 'dep-get-missing');
      await deploymentModel.addRevision(revisionValues('dep-get-missing', 1));

      expect(await deploymentModel.getRevision('dep-get-missing', 9)).toBeUndefined();
    });

    it('does not return revisions of another user’s deployment', async () => {
      await createDeployment(otherDeploymentModel, 'dep-get-revision-other');
      await otherDeploymentModel.addRevision(revisionValues('dep-get-revision-other', 1));

      expect(await deploymentModel.getRevision('dep-get-revision-other', 1)).toBeUndefined();
    });
  });

  describe('reserveRevision', () => {
    it('hands out the revision after the newest one, even after a rollback', async () => {
      await createDeployment(deploymentModel, 'dep-reserve', { currentRevision: 1 });
      for (const revision of [1, 2, 3]) {
        await deploymentModel.addRevision(revisionValues('dep-reserve', revision));
      }
      // The panel restored v1; `currentRevision` is no longer the high-water mark.
      await deploymentModel.update('dep-reserve', { currentRevision: 1 });

      expect(await deploymentModel.reserveRevision('dep-reserve')).toBe(4);
      expect(await deploymentModel.reserveRevision('dep-reserve')).toBe(5);
    });

    it('gives concurrent allocations distinct numbers', async () => {
      await createDeployment(deploymentModel, 'dep-race');

      const revisions = await Promise.all(
        Array.from({ length: 8 }, () => deploymentModel.reserveRevision('dep-race')),
      );

      expect(new Set(revisions).size).toBe(8);
    });

    it('does not allocate for a deployment the caller cannot see', async () => {
      await createDeployment(deploymentModel, 'dep-reserve-other');

      await expect(otherDeploymentModel.reserveRevision('dep-reserve-other')).rejects.toThrow();
    });
  });

  describe('getPublishedDeployment', () => {
    it('returns the deployment with the revision currentRevision points at', async () => {
      await createDeployment(deploymentModel, 'dep-published', { currentRevision: 2 });
      await deploymentModel.addRevision(revisionValues('dep-published', 1));
      await deploymentModel.addRevision(revisionValues('dep-published', 2));

      const result = await getPublishedDeployment(serverDB, 'dep-published');

      expect(result?.deployment.id).toBe('dep-published');
      expect(result?.revision.revision).toBe(2);
    });

    it('is readable without a session, so it also resolves another user’s deployment', async () => {
      await createDeployment(otherDeploymentModel, 'dep-published-other');
      await otherDeploymentModel.addRevision(revisionValues('dep-published-other', 1));

      const result = await getPublishedDeployment(serverDB, 'dep-published-other');

      expect(result?.deployment.userId).toBe(otherUserId);
    });

    it('returns undefined while the deployment is offline', async () => {
      await createDeployment(deploymentModel, 'dep-offline', { status: 'offline' });
      await deploymentModel.addRevision(revisionValues('dep-offline', 1));

      expect(await getPublishedDeployment(serverDB, 'dep-offline')).toBeUndefined();
    });

    it('returns undefined when the current revision has not been written', async () => {
      await createDeployment(deploymentModel, 'dep-no-revision', { currentRevision: 3 });
      await deploymentModel.addRevision(revisionValues('dep-no-revision', 1));

      expect(await getPublishedDeployment(serverDB, 'dep-no-revision')).toBeUndefined();
    });

    it('returns undefined for an unknown id', async () => {
      expect(await getPublishedDeployment(serverDB, 'dep-missing')).toBeUndefined();
    });
  });
});
