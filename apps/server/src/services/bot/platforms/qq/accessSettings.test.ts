import { describe, expect, it } from 'vitest';

import { extractGroupSettings, validateAccessSettings } from '../const';
import { devicePolicyField } from '../deviceAccess';
import { mergeWithDefaults } from '../utils';
import {
  canUseQqGroupDevices,
  normalizeQqAccessSettings,
  QQ_DEVICE_POLICIES,
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
    expect(devicePolicyField.enum).toEqual(['owner', 'allowlist']);
    expect(QQ_DEVICE_POLICIES).toEqual(['owner', 'allowlist', 'group']);
    expect(field('devicePolicy')?.enum).toEqual(QQ_DEVICE_POLICIES);
    expect(field('devicePolicy')?.default).toBe('owner');
    expect(field('devicePolicy')?.enumLabels).toEqual([
      'channel.qq.access.device.owner',
      'channel.qq.access.device.allowlist',
      'channel.qq.access.device.group',
    ]);
    expect(field('devicePolicy')?.enumDescriptions).toEqual([
      'channel.qq.access.device.ownerDesc',
      'channel.qq.access.device.allowlistDesc',
      'channel.qq.access.device.groupDesc',
    ]);
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

  it('keeps the /bind ownerBoundAt marker through QQ normalization and defaults', () => {
    const settings = {
      dmPolicy: 'allowlist',
      ownerBoundAt: '2026-11-14T10:00:00.000Z',
      userId: '4052DFFF',
    };

    // The legacy-policy migration spreads the whole settings object, so the
    // marker written by /bind must survive both the read projection and the
    // schema-default merge used when the form saves.
    expect(normalizeQqAccessSettings(settings)).toMatchObject({
      dmPolicy: 'pairing',
      ownerBoundAt: settings.ownerBoundAt,
      userId: '4052DFFF',
    });
    expect(normalizeQqAccessSettings({ ownerBoundAt: settings.ownerBoundAt })).toEqual({
      ownerBoundAt: settings.ownerBoundAt,
    });
    expect(mergeWithDefaults(qq.schema, settings)).toMatchObject({
      ownerBoundAt: settings.ownerBoundAt,
      userId: '4052DFFF',
    });
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
  it('applies group device access only through the selected group policy', () => {
    expect(canUseQqGroupDevices('open')).toBe(true);
    expect(canUseQqGroupDevices('pairing')).toBe(true);
    expect(canUseQqGroupDevices('admins', 'owner')).toBe(true);
    expect(canUseQqGroupDevices('admins', 'admin')).toBe(true);
    expect(canUseQqGroupDevices('admins', 'member')).toBe(false);
    expect(canUseQqGroupDevices('admins')).toBe(false);
    expect(canUseQqGroupDevices('allowlist')).toBe(false);
    expect(canUseQqGroupDevices('disabled')).toBe(false);
    expect(canUseQqGroupDevices('disabled', 'owner')).toBe(false);
  });
});
