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
 *
 * Returns `undefined` when every matching entry already approves all given
 * roots (or when no entry matches), so callers can skip the redundant DB write.
 */
export const addApprovedPreviewRoots = (
  workingDirs: readonly WorkingDirEntry[],
  scope: string,
  roots: readonly string[],
): WorkingDirEntry[] | undefined => {
  const approvedPreviewRoots = [...new Set(roots.filter(Boolean))];
  if (approvedPreviewRoots.length === 0) return undefined;

  let changed = false;
  let matchedAny = false;
  const nextWorkingDirs = workingDirs.map((entry) => {
    const effectivePath = getWorkingDirEffectivePath(entry);
    const matchesScope =
      isPathWithinRoot(entry.path, scope) ||
      (effectivePath !== undefined &&
        effectivePath !== entry.path &&
        isPathWithinRoot(effectivePath, scope));
    if (!matchesScope) return entry;
    matchedAny = true;

    const existingRoots = entry.workspace?.approvedPreviewRoots ?? [];
    const mergedRoots = [...new Set([...existingRoots, ...approvedPreviewRoots])];

    // All requested roots are already approved on this entry: the merged list
    // is identical to the stored one, so skip the entry instead of writing an
    // equal array back to the DB (write-amplification short-circuit).
    if (mergedRoots.length === existingRoots.length) return entry;

    changed = true;
    return {
      ...entry,
      workspace: {
        ...entry.workspace,
        approvedPreviewRoots: mergedRoots,
        instructions: entry.workspace?.instructions ?? [],
        skills: entry.workspace?.skills ?? [],
      },
    };
  });

  if (changed) return nextWorkingDirs;

  // No working-dir entry matched the scope: `defaultCwd` is also an approved
  // root but may not yet have a matching MRU entry. This request already
  // passed the server-side root guard, so cache the device-reported roots
  // against that approved scope for future previews.
  //
  // The `{ path: scope, workspace }` entry below is a server-owned synthetic
  // entry — the client never authored it. It intentionally surfaces in the
  // working-directory picker and agent context resolution as a registered
  // device workspace (the "register device workspaces" behavior).
  if (!matchedAny) {
    return [
      {
        path: scope,
        workspace: { approvedPreviewRoots, instructions: [], skills: [] },
      },
      ...workingDirs,
    ].slice(0, 20);
  }

  // Every matching entry already approves all requested roots: the merged
  // result is identical to the input, so signal "no write needed" instead of
  // returning the unchanged list (the caller only updates when defined).
  return undefined;
};
