// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { artifactShareRouter } from '@/business/server/lambda-routers/artifactShare';

const mocks = vi.hoisted(() => ({ getPublicArtifact: vi.fn(), serverDB: {} }));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(async () => mocks.serverDB),
}));

vi.mock('@/server/services/artifactDeployment', () => ({
  getPublicArtifact: mocks.getPublicArtifact,
}));

// The share page is visited without a session, so the caller carries no user.
const caller = () => artifactShareRouter.createCaller({} as any);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('artifactShareRouter.getShared', () => {
  it('serves a published artifact to an anonymous visitor', async () => {
    mocks.getPublicArtifact.mockResolvedValue({
      id: 'dep-1',
      iframeSrc: '/artifact-render/dep-1/',
      title: 'Sales dashboard',
    } as any);

    await expect(caller().getShared({ id: 'dep-1' })).resolves.toEqual({
      id: 'dep-1',
      iframeSrc: '/artifact-render/dep-1/',
      title: 'Sales dashboard',
    });
    expect(mocks.getPublicArtifact).toHaveBeenCalledWith(mocks.serverDB, 'dep-1');
  });

  it('keeps a null title null', async () => {
    mocks.getPublicArtifact.mockResolvedValue({
      id: 'dep-1',
      iframeSrc: '/artifact-render/dep-1/',
      title: null,
    } as any);

    await expect(caller().getShared({ id: 'dep-1' })).resolves.toEqual({
      id: 'dep-1',
      iframeSrc: '/artifact-render/dep-1/',
      title: null,
    });
  });

  it('answers NOT_FOUND for an unpublished or unknown artifact', async () => {
    mocks.getPublicArtifact.mockResolvedValue(null);

    await expect(caller().getShared({ id: 'dep-missing' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(caller().getShared({ id: 'dep-missing' })).rejects.toBeInstanceOf(TRPCError);
  });
});
