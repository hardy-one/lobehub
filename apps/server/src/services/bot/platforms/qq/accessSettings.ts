import type { DmPolicy, GroupPolicy } from '../const';
import type { DevicePolicy } from '../deviceAccess';
import type { FieldSchema } from '../types';

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

export const QQ_DEVICE_POLICIES = [
  'owner',
  'allowlist',
  'group',
] as const satisfies readonly DevicePolicy[];

export const qqDevicePolicyField: FieldSchema = {
  key: 'devicePolicy',
  default: 'owner',
  description: 'channel.devicePolicyHint',
  enum: [...QQ_DEVICE_POLICIES],
  enumDescriptions: [
    'channel.qq.access.device.ownerDesc',
    'channel.qq.access.device.allowlistDesc',
    'channel.qq.access.device.groupDesc',
  ],
  enumLabels: [
    'channel.qq.access.device.owner',
    'channel.qq.access.device.allowlist',
    'channel.qq.access.device.group',
  ],
  label: 'channel.devicePolicy',
  type: 'string',
};

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
  return policy === 'open' || policy === 'pairing';
}
