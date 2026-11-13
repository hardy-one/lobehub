import { describe, expect, it } from 'vitest';

import { extractGroupSettings, validateAccessSettings } from '../const';
import { mergeWithDefaults } from '../utils';
import {
  canUseQqGroupDevices,
  normalizeQqAccessSettings,
  QQ_DM_POLICIES,
  QQ_GROUP_ACCEPTED_POLICIES,
  QQ_GROUP_POLICIES,
} from './accessSettings';
import { qq } from './definition';
import { schema } from './schema';

describe('QQ access settings declaration', () => {
  const settingsFields = schema.find((field) => field.key === 'settings')?.properties ?? [];
  const field = (key: string) => settingsFields.find((item) => item.key === key);

  it('declares three selectable QQ group policies and marks approval-managed fields', () => {
    expect(QQ_DM_POLICIES).toEqual(['open', 'pairing', 'disabled']);
    expect(QQ_GROUP_POLICIES).toEqual(['open', 'pairing', 'admins']);
    expect(QQ_GROUP_ACCEPTED_POLICIES).toEqual([...QQ_GROUP_POLICIES, 'disabled']);
    expect(field('dmPolicy')?.enum).toEqual(QQ_DM_POLICIES);
    expect(field('groupPolicy')?.enum).toEqual(QQ_GROUP_POLICIES);
    expect(field('groupAllowFrom')?.managed).toBe(true);
    expect(field('allowFrom')?.managed).toBe(true);
    expect(field('deviceAllowFrom')?.managed).toBe(true);
    expect(field('userId')?.managed).toBe(true);
    expect(qq.accessCapabilities?.ownerBinding).toBe(true);
  });

  it('migrates QQ allowlist policies to pairing without dropping approved identities', () => {
    const settings = {
      allowFrom: [{ id: 'user-openid', name: 'Ada' }],
      deviceAllowFrom: [{ id: 'legacy-device' }],
      dmPolicy: 'allowlist',
      groupAllowFrom: [{ id: 'group-openid', name: 'Team' }],
      groupPolicy: 'allowlist',
    };

    expect(normalizeQqAccessSettings(settings)).toEqual({
      ...settings,
      dmPolicy: 'pairing',
      groupPolicy: 'pairing',
    });
    expect(normalizeQqAccessSettings({ dmPolicy: 'open' })).toEqual({ dmPolicy: 'open' });
  });

  it('preserves legacy disabled group policy through persistence and QQ runtime extraction', () => {
    const settings = { groupAllowFrom: ['approved-group'], groupPolicy: 'disabled' };
    const persisted = normalizeQqAccessSettings(mergeWithDefaults(qq.schema, settings));

    expect(persisted).toMatchObject({
      groupAllowFrom: ['approved-group'],
      groupPolicy: 'disabled',
    });
    expect(validateAccessSettings(persisted)).toEqual({ valid: true });
    expect(
      extractGroupSettings(persisted, { acceptedPolicies: QQ_GROUP_ACCEPTED_POLICIES }),
    ).toEqual({ allowFrom: ['approved-group'], policy: 'disabled' });
  });
  it('applies group device access from the selected group policy', () => {
    expect(canUseQqGroupDevices('open')).toBe(true);
    expect(canUseQqGroupDevices('pairing')).toBe(true);
    expect(canUseQqGroupDevices('admins', 'owner')).toBe(true);
    expect(canUseQqGroupDevices('admins', 'admin')).toBe(true);
    expect(canUseQqGroupDevices('admins', 'member')).toBe(false);
    expect(canUseQqGroupDevices('admins')).toBe(false);
    expect(canUseQqGroupDevices('disabled')).toBe(false);
    expect(canUseQqGroupDevices('disabled', 'owner')).toBe(false);
  });
});
