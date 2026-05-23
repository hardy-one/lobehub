import { getWorkingDirEffectivePath, type WorkingDirEntry } from '@lobechat/types';

import { isPathWithinRoot } from '@/server/services/deviceGateway';

/**
 * Re-attach the server-owned workspace-init cache (`workspace` /
 * `workspaceScannedAt`) onto a client-supplied `workingDirs` list, matched by
 * `path`.
 *
 * The device update inputs validate only user-owned directory metadata
 * (`path`, `repoType`, `git`) and zod strips everything else, so a client cwd
 * save would otherwise overwrite the JSONB column with cache-less entries —
 * wiping the scan written by `resolveWorkspaceInit` and forcing every later run
 * to rescan. The cache is server-produced (the client never authors it), so we
 * restore it here rather than trusting the client to round-trip it.
 *
 * Entries dropped from `incoming` (e.g. the user removed a dir) lose their cache
 * by design; brand-new paths simply have none yet.
 */
export const preserveWorkspaceCache = (
  incoming: WorkingDirEntry[],
  stored: readonly WorkingDirEntry[] = [],
): WorkingDirEntry[] => {
  const cachedByPath = new Map(stored.filter((dir) => dir.workspace).map((dir) => [dir.path, dir]));
  if (cachedByPath.size === 0) return incoming;

  return incoming.map((entry) => {
    const cached = cachedByPath.get(entry.path);
    return cached
      ? { ...entry, workspace: cached.workspace, workspaceScannedAt: cached.workspaceScannedAt }
      : entry;
  });
};

/**
 * Persist device-reported skill preview roots on the bound working-directory
 * entry. The client update schema strips this server-owned cache and
 * `preserveWorkspaceCache` restores it on later cwd saves.
 */
export const addApprovedPreviewRoots = (
  workingDirs: readonly WorkingDirEntry[],
  scope: string,
  roots: readonly string[],
): WorkingDirEntry[] | undefined => {
  const approvedPreviewRoots = [...new Set(roots.filter(Boolean))];
  if (approvedPreviewRoots.length === 0) return undefined;

  let changed = false;
  const nextWorkingDirs = workingDirs.map((entry) => {
    const effectivePath = getWorkingDirEffectivePath(entry);
    const matchesScope =
      isPathWithinRoot(entry.path, scope) ||
      (effectivePath !== entry.path && isPathWithinRoot(effectivePath, scope));
    if (!matchesScope) return entry;

    changed = true;
    return {
      ...entry,
      workspace: {
        ...entry.workspace,
        approvedPreviewRoots: [
          ...new Set([...(entry.workspace?.approvedPreviewRoots ?? []), ...approvedPreviewRoots]),
        ],
        instructions: entry.workspace?.instructions ?? [],
        skills: entry.workspace?.skills ?? [],
      },
    };
  });

  if (changed) return nextWorkingDirs;

  // `defaultCwd` is also an approved root but may not yet have a matching MRU
  // entry. This request already passed the server-side root guard, so cache the
  // device-reported roots against that approved scope for future previews.
  return [
    {
      path: scope,
      workspace: { approvedPreviewRoots, instructions: [], skills: [] },
    },
    ...workingDirs,
  ].slice(0, 20);
};
