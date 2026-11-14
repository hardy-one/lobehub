export interface OwnerBindingForm {
  getSettings: () => Record<string, unknown>;
  setSettings: (settings: Record<string, unknown>) => void;
  validate: (names: string[]) => Promise<unknown>;
}

export interface OwnerBindingSnapshot {
  /** `settings.ownerBoundAt`, written by `/bind` as a UTC ISO timestamp. */
  boundAt?: unknown;
  /** `settings.userId`, the bound owner's platform id. */
  ownerId?: unknown;
}

const asTrimmedString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

/**
 * A bind is proven only by the bind event itself: either the stored owner id
 * changed, or `/bind` wrote a new `settings.ownerBoundAt`.
 *
 * A provider row's `updatedAt` is deliberately NOT an input here — it moves on
 * every settings save, so inferring completion from it made "重新绑定" report
 * success immediately, before the freshly generated code could ever be used
 * (LOBE-166). A missing `ownerBoundAt` is fail-closed.
 */
export const isOwnerBindingComplete = (
  previous: OwnerBindingSnapshot,
  current: OwnerBindingSnapshot,
): boolean => {
  const ownerId = asTrimmedString(current?.ownerId);
  if (!ownerId) return false;

  // A different owner is proof on its own, with or without a bind marker.
  if (ownerId !== asTrimmedString(previous?.ownerId)) return true;

  // Same owner: only a *present* marker that differs proves a fresh /bind.
  // `undefined -> timestamp` covers the first bind on a legacy row that has no
  // marker yet; a missing current marker never completes (fail-closed).
  const boundAt = asTrimmedString(current?.boundAt);
  if (!boundAt) return false;

  return boundAt !== asTrimmedString(previous?.boundAt);
};

/** Merge the server-bound owner ID into the live settings without losing unsaved edits. */
export const syncOwnerBindingUserId = (
  form: OwnerBindingForm,
  ownerId: string,
  onFilled?: () => void,
): boolean => {
  const normalizedId = ownerId.trim();
  const current = form.getSettings();
  if (!normalizedId || current.userId === normalizedId) return false;

  form.setSettings({ ...current, userId: normalizedId });
  void form.validate(['settings.userId']);
  onFilled?.();
  return true;
};
