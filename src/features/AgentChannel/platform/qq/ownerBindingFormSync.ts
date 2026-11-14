export interface OwnerBindingForm {
  getSettings: () => Record<string, unknown>;
  setSettings: (settings: Record<string, unknown>) => void;
  validate: (names: string[]) => Promise<unknown>;
}

export type OwnerBindingVersion = Date | number | string | null | undefined;

const getVersionTimestamp = (version: OwnerBindingVersion): number | undefined => {
  if (version instanceof Date) {
    const timestamp = version.getTime();
    return Number.isFinite(timestamp) ? timestamp : undefined;
  }
  if (typeof version === 'number') return Number.isFinite(version) ? version : undefined;
  if (typeof version !== 'string') return undefined;

  const timestamp = Date.parse(version);
  return Number.isFinite(timestamp) ? timestamp : undefined;
};

/** A bind may keep the same owner ID; the provider update timestamp proves that it completed. */
export const isOwnerBindingComplete = (
  previousOwnerId: string | undefined,
  previousUpdatedAt: OwnerBindingVersion,
  currentOwnerId: unknown,
  currentUpdatedAt: OwnerBindingVersion,
  issuedAt: number,
): boolean => {
  const ownerId = typeof currentOwnerId === 'string' ? currentOwnerId.trim() : '';
  if (!ownerId) return false;
  if (ownerId !== previousOwnerId?.trim()) return true;

  const previousVersion = getVersionTimestamp(previousUpdatedAt);
  const currentVersion = getVersionTimestamp(currentUpdatedAt);
  return (
    (previousVersion !== undefined &&
      currentVersion !== undefined &&
      previousVersion !== currentVersion) ||
    (currentVersion !== undefined && currentVersion > issuedAt)
  );
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
