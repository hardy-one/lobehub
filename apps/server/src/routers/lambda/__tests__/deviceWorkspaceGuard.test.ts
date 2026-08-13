import { TRPCError } from '@trpc/server';
import { describe, expect, it, vi } from 'vitest';

import type { DeviceModel } from '@/database/models/device';
import { isPathWithinRoot } from '@/server/services/deviceGateway';

import { assertWorkspaceDeviceVisible, assertWorkspaceRootApproved } from '../deviceWorkspaceGuard';

const mockModel = (
  row: {
    defaultCwd?: string | null;
    workingDirs?: Array<{
      git?: { activeWorktree?: string };
      path: string;
      workspace?: { approvedPreviewRoots?: string[] };
    }>;
  } | null,
) =>
  ({
    findByDeviceId: vi.fn().mockResolvedValue(row),
  }) as unknown as DeviceModel;

describe('assertWorkspaceRootApproved', () => {
  it('allows a root that exactly matches a bound workingDir', async () => {
    const model = mockModel({ workingDirs: [{ path: '/Users/me/proj' }] });
    await expect(
      assertWorkspaceRootApproved(model, 'dev-1', '/Users/me/proj'),
    ).resolves.toBeUndefined();
  });

  it('allows a root nested inside a bound workingDir', async () => {
    const model = mockModel({ workingDirs: [{ path: '/Users/me/proj' }] });
    await expect(
      assertWorkspaceRootApproved(model, 'dev-1', '/Users/me/proj/packages/app'),
    ).resolves.toBeUndefined();
  });

  it('allows a root matching defaultCwd when no workingDirs match', async () => {
    const model = mockModel({ defaultCwd: '/Users/me/default', workingDirs: [] });
    await expect(
      assertWorkspaceRootApproved(model, 'dev-1', '/Users/me/default'),
    ).resolves.toBeUndefined();
  });

  it('rejects a root that escapes the approved roots (filesystem root)', async () => {
    const model = mockModel({ workingDirs: [{ path: '/Users/me/proj' }] });
    await expect(assertWorkspaceRootApproved(model, 'dev-1', '/')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('rejects a sibling directory that shares a path prefix but is not contained', async () => {
    const model = mockModel({ workingDirs: [{ path: '/Users/me/proj' }] });
    await expect(
      assertWorkspaceRootApproved(model, 'dev-1', '/Users/me/proj-evil'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('allows a root that matches a worktree activeWorktree', async () => {
    const model = mockModel({
      workingDirs: [{ path: '/Users/me/proj', git: { activeWorktree: '/Users/me/proj-feat-x' } }],
    });
    await expect(
      assertWorkspaceRootApproved(model, 'dev-1', '/Users/me/proj-feat-x'),
    ).resolves.toBeUndefined();
  });

  it('allows a file-preview root reported by a device-scoped skill scan', async () => {
    const model = mockModel({
      workingDirs: [
        {
          path: '/Users/me/proj',
          workspace: { approvedPreviewRoots: ['/Users/me/.agents/skills'] },
        },
      ],
    });

    await expect(
      assertWorkspaceRootApproved(model, 'dev-1', '/Users/me/.agents/skills/reviewer'),
    ).resolves.toBeUndefined();
  });

  it('rejects when the device has no approved roots at all', async () => {
    const model = mockModel({ workingDirs: [] });
    await expect(
      assertWorkspaceRootApproved(model, 'dev-1', '/Users/me/proj'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects when the device row is missing', async () => {
    const model = mockModel(null);
    await expect(
      assertWorkspaceRootApproved(model, 'dev-1', '/Users/me/proj'),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it('rejects an empty workspace root with BAD_REQUEST before hitting the DB', async () => {
    const model = mockModel({ workingDirs: [{ path: '/Users/me/proj' }] });
    await expect(assertWorkspaceRootApproved(model, 'dev-1', '')).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(model.findByDeviceId).not.toHaveBeenCalled();
  });
});

describe('assertWorkspaceDeviceVisible', () => {
  const mockHiddenModel = (hiddenIds: string[]) =>
    ({
      queryWorkspaceHiddenDeviceIds: vi.fn().mockResolvedValue(hiddenIds),
    }) as unknown as DeviceModel;

  it('allows a device the caller can see', async () => {
    const model = mockHiddenModel(['someone-elses-private']);
    await expect(assertWorkspaceDeviceVisible(model, 'public-dev')).resolves.toBeUndefined();
  });

  it('allows a transient device with no DB row (empty hidden set)', async () => {
    const model = mockHiddenModel([]);
    await expect(assertWorkspaceDeviceVisible(model, 'transient-dev')).resolves.toBeUndefined();
  });

  it("rejects another member's private device with NOT_FOUND", async () => {
    const model = mockHiddenModel(['someone-elses-private']);
    await expect(
      assertWorkspaceDeviceVisible(model, 'someone-elses-private'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('isPathWithinRoot', () => {
  it('allows an exact match and nested targets', () => {
    expect(isPathWithinRoot('/Users/me/proj', '/Users/me/proj')).toBe(true);
    expect(isPathWithinRoot('/Users/me/proj', '/Users/me/proj/packages/app')).toBe(true);
  });

  it('rejects siblings sharing a path prefix and targets outside the root', () => {
    expect(isPathWithinRoot('/Users/me/proj', '/Users/me/proj-evil')).toBe(false);
    expect(isPathWithinRoot('/Users/me/proj', '/Users/me/other')).toBe(false);
    expect(isPathWithinRoot('/Users/me/proj', '/')).toBe(false);
  });

  it('rejects non-absolute roots or targets', () => {
    expect(isPathWithinRoot('Users/me/proj', '/Users/me/proj/x')).toBe(false);
    expect(isPathWithinRoot('/Users/me/proj', 'Users/me/proj/x')).toBe(false);
  });

  it('handles Windows drive paths with win32 semantics', () => {
    expect(isPathWithinRoot('C:\\proj', 'C:\\proj\\src\\index.ts')).toBe(true);
    expect(isPathWithinRoot('C:\\proj', 'C:\\proj-evil')).toBe(false);
    expect(isPathWithinRoot('C:\\proj', 'D:\\proj')).toBe(false);
  });

  it('handles UNC share paths (\\server\\share) with win32 semantics', () => {
    expect(isPathWithinRoot('\\\\server\\share', '\\\\server\\share')).toBe(true);
    expect(isPathWithinRoot('\\\\server\\share', '\\\\server\\share\\repo\\src')).toBe(true);
    expect(isPathWithinRoot('\\\\server\\share', '\\\\server\\share-evil')).toBe(false);
    expect(isPathWithinRoot('\\\\server\\share', '\\\\other\\share')).toBe(false);
  });
});
