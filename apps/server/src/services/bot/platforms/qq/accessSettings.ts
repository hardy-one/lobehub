import type { DmPolicy, GroupPolicy } from '../const';

export const QQ_DM_POLICIES = [
  'open',
  'pairing',
  'disabled',
] as const satisfies readonly DmPolicy[];
export const QQ_GROUP_POLICIES = [
  'open',
  'pairing',
  'admins',
] as const satisfies readonly GroupPolicy[];

/** Runtime also accepts persisted `disabled`; that legacy value is not selectable. */
export const QQ_GROUP_ACCEPTED_POLICIES = [
  ...QQ_GROUP_POLICIES,
  'disabled',
] as const satisfies readonly GroupPolicy[];

/**
 * Migrate QQ's legacy allowlist policy to pairing without changing stored `disabled`.
 * `disabled` is intentionally not selectable, but existing settings must remain
 * readable and saveable with their fail-closed, owner-only runtime behavior.
 */
export function normalizeQqAccessSettings(
  settings: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null | undefined {
  if (!settings) return settings;

  const dmPolicy = settings.dmPolicy === 'allowlist' ? 'pairing' : settings.dmPolicy;
  const groupPolicy = settings.groupPolicy === 'allowlist' ? 'pairing' : settings.groupPolicy;
  if (dmPolicy === settings.dmPolicy && groupPolicy === settings.groupPolicy) return settings;

  return { ...settings, dmPolicy, groupPolicy };
}

export function canUseQqGroupDevices(
  policy: GroupPolicy,
  memberRole?: 'admin' | 'member' | 'owner',
): boolean {
  if (policy === 'admins') return memberRole === 'owner' || memberRole === 'admin';
  return policy === 'open' || policy === 'pairing' || policy === 'allowlist';
}
