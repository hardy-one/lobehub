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
  'disabled',
] as const satisfies readonly GroupPolicy[];

/** Convert QQ's legacy allowlist value to its equivalent pairing policy. */
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
