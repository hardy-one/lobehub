'use client';

import { confirmModal, Text } from '@lobehub/ui';
import { Form, type FormInstance, useWatch } from '@lobehub/ui/form';
import { memo, type ReactNode, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { FieldSchema } from '@/server/services/bot/platforms/types';

import {
  type AccessSettings,
  applyDmPolicy,
  countListed,
  deriveDmPolicy,
  dropHiddenIncompleteRows,
  getDeclaredPolicy,
} from './accessStance';
import { ChoiceList, type ChoiceOption } from './ChoiceList';
import type { ChannelFormValues } from './index';
import { SchemaField } from './SchemaField';
import type { AccessSectionKey } from './settingsGroups';

interface AccessSectionProps {
  disabled?: boolean;
  /** The access fields the platform declares; only ones present are shown. */
  fields: FieldSchema[];
  form: FormInstance<ChannelFormValues>;
  onValuesChange?: (values: ChannelFormValues) => void;
  platformId: string;
  /** Platform helper rendered right under the owner ID field (e.g. Feishu's lookup). */
  section: AccessSectionKey;
  userIdExtras?: ReactNode;
}

const POLICY_COPY_ALIASES: Record<string, { description: string; label: string }> = {
  'channel.dmPolicyAllowlist': {
    description: 'channel.access.dm.listedDesc',
    label: 'channel.access.dm.listed',
  },
  'channel.dmPolicyDisabled': {
    description: 'channel.access.dm.closedDesc',
    label: 'channel.access.dm.closed',
  },
  'channel.dmPolicyOpen': {
    description: 'channel.access.dm.everyoneDesc',
    label: 'channel.access.dm.everyone',
  },
  'channel.dmPolicyPairing': {
    description: 'channel.access.dm.approvalDesc',
    label: 'channel.access.dm.approval',
  },
  'channel.groupPolicyAllowlist': {
    description: 'channel.access.group.allowlistDesc',
    label: 'channel.access.group.allowlist',
  },
  'channel.groupPolicyDisabled': {
    description: 'channel.access.group.disabledDesc',
    label: 'channel.access.group.disabled',
  },
  'channel.groupPolicyOpen': {
    description: 'channel.access.group.openDesc',
    label: 'channel.access.group.open',
  },
};

const ACCESS_COPY_PREFIX: Record<string, string> = {
  devicePolicy: 'channel.access.device',
  dmPolicy: 'channel.access.dm',
  groupPolicy: 'channel.access.group',
};

const ACCESS_POLICY_ORDER = ['open', 'pairing', 'allowlist', 'disabled', 'admins'];

const getAccessPolicyRank = (value: string, schemaIndex: number) => {
  const orderIndex = ACCESS_POLICY_ORDER.indexOf(value);
  return orderIndex === -1 ? ACCESS_POLICY_ORDER.length + schemaIndex : orderIndex;
};

const getPolicyOption = (
  field: FieldSchema,
  value: string,
  index: number,
  platformId: string,
  t: (key: string, options?: Record<string, unknown>) => string,
): ChoiceOption<string> => {
  const declaredLabel = field.enumLabels?.[index];
  const alias = declaredLabel ? POLICY_COPY_ALIASES[declaredLabel] : undefined;
  let labelKey = alias?.label ?? declaredLabel;
  let descriptionKey = alias?.description ?? field.enumDescriptions?.[index];

  if (platformId === 'qq' && field.key === 'dmPolicy' && value === 'pairing') {
    labelKey = 'channel.qq.access.dm.pairing';
  }
  if (platformId === 'qq' && field.key === 'groupPolicy' && value === 'pairing') {
    labelKey = 'channel.qq.access.group.pairing';
  }
  if (platformId === 'qq' && field.key === 'groupPolicy' && value === 'admins') {
    labelKey = 'channel.qq.access.group.admins';
  }

  if (platformId === 'qq' && field.key === 'devicePolicy') {
    labelKey = `channel.qq.access.device.${value}`;
    descriptionKey = `channel.qq.access.device.${value}Desc`;
  }

  const prefix = ACCESS_COPY_PREFIX[field.key];
  return {
    desc: descriptionKey ? t(descriptionKey) : prefix ? t(`${prefix}.${value}Desc`) : undefined,
    label: labelKey ? t(labelKey) : prefix ? t(`${prefix}.${value}`) : value,
    recommendedLabel:
      field.enumRecommended === value ||
      (field.key === 'dmPolicy' && declaredLabel === 'channel.dmPolicyPairing') ||
      (field.key === 'devicePolicy' && value === field.default)
        ? t('channel.access.recommended')
        : undefined,
    value,
  };
};

/**
 * The runtime owns the policy values. This section turns each platform's
 * declared enum into the corresponding access choices and keeps its lists in
 * step with the policy selected above them.
 */
export const AccessSection = memo<AccessSectionProps>(
  ({ disabled, fields, form, onValuesChange, platformId, section, userIdExtras }) => {
    const { t: _t } = useTranslation('agent');
    const t = _t as (key: string, options?: Record<string, unknown>) => string;

    const byKey = useMemo(() => new Map(fields.map((field) => [field.key, field])), [fields]);
    const watched = useWatch(form, (values) => values.settings);
    const settings = useMemo(() => (watched ?? {}) as AccessSettings, [watched]);

    const dmField = byKey.get('dmPolicy');
    const groupField = byKey.get('groupPolicy');
    const deviceField = byKey.get('devicePolicy');
    const dmPolicy = deriveDmPolicy(settings, dmField);
    const groupPolicy = getDeclaredPolicy(groupField, settings.groupPolicy);
    const devicePolicy = getDeclaredPolicy(deviceField, settings.devicePolicy);
    const hasPeopleList = countListed(settings.allowFrom) > 0;

    const write = useCallback(
      (patch: Record<string, unknown>) => {
        const current = (form.getValues().settings ?? {}) as Record<string, unknown>;
        const next = { ...current, ...patch };
        // A hidden, unfinished row must not keep its required-ID error active.
        Object.assign(next, dropHiddenIncompleteRows(next as AccessSettings, fields));
        form.setValues({ settings: next as Record<string, {} | undefined> });
        onValuesChange?.(form.getValues());
      },
      [fields, form, onValuesChange],
    );

    const handleDmPolicy = (next: string) => {
      if (next === dmPolicy) return;
      const { dropped, patch } = applyDmPolicy(next, settings, dmField);

      // On platforms where the list is a global restriction, opening DMs also
      // removes its entries. Confirm before dropping approved users.
      if (dropped > 0) {
        confirmModal({
          content: t('channel.access.list.clearContent', { count: dropped }),
          okText: t('channel.access.list.clearOk'),
          onOk: () => write(patch),
          title: t('channel.access.list.clearTitle'),
        });
        return;
      }

      write(patch);
    };

    const optionsFor = (field?: FieldSchema): ChoiceOption<string>[] => {
      const declaredOptions = (field?.enum ?? []).map((value, index) => ({ value, index }));
      if (field?.key !== 'devicePolicy') {
        declaredOptions.sort(
          (left, right) =>
            getAccessPolicyRank(left.value, left.index) -
            getAccessPolicyRank(right.value, right.index),
        );
      }

      return declaredOptions.map(({ value, index }) =>
        getPolicyOption(field!, value, index, platformId, t),
      );
    };
    const dmOptions = optionsFor(dmField);
    const groupOptions = optionsFor(groupField);
    const deviceOptions = optionsFor(deviceField);

    const userId = byKey.get('userId');
    const serverId = byKey.get('serverId');
    const allowFrom = byKey.get('allowFrom');
    const guestPolicy = byKey.get('guestPolicy');
    const groupAllowFrom = byKey.get('groupAllowFrom');
    const groupListVisible = (() => {
      if (!groupAllowFrom?.visibleWhen) return true;
      const conditions = Array.isArray(groupAllowFrom.visibleWhen)
        ? groupAllowFrom.visibleWhen
        : [groupAllowFrom.visibleWhen];
      return conditions.every(({ field: key, value: expected }) => {
        const actual = key === 'groupPolicy' ? groupPolicy : settings[key as keyof AccessSettings];
        return Array.isArray(expected) ? expected.includes(actual) : actual === expected;
      });
    })();
    const deviceAllowFrom = byKey.get('deviceAllowFrom');

    const ownerMissing = !(typeof settings.userId === 'string' && settings.userId.trim());
    const approverMissing = dmPolicy === 'pairing' && ownerMissing;
    const listVisible =
      dmPolicy === 'pairing' ||
      (dmField?.enum?.includes('allowlist') && dmPolicy === 'allowlist') ||
      hasPeopleList;
    const legacyDisabledGroup =
      platformId === 'qq' &&
      settings.groupPolicy === 'disabled' &&
      !groupField?.enum?.includes('disabled');

    if (section === 'identity')
      return (
        <>
          {userId && (
            <>
              <SchemaField
                disabled={disabled}
                field={userId}
                hidden={userId.managed && !!userIdExtras}
                parentKey="settings"
                descOverride={
                  !userId.managed ? (
                    <>
                      {t('channel.access.identity.desc')}
                      {approverMissing && (
                        <Text fontSize={12} style={{ display: 'block' }} type="warning">
                          {platformId === 'qq'
                            ? t('channel.qq.ownerBinding.approverMissing')
                            : t('channel.access.identity.approverMissing')}
                        </Text>
                      )}
                    </>
                  ) : undefined
                }
                validateOverride={() =>
                  getDeclaredPolicy(dmField, form.getValue('settings.dmPolicy')) === 'pairing' &&
                  !String(form.getValue('settings.userId') ?? '').trim()
                    ? t('channel.access.identity.required')
                    : undefined
                }
              />
              {userIdExtras}
            </>
          )}
          {serverId && (
            <SchemaField divider disabled={disabled} field={serverId} parentKey="settings" />
          )}
        </>
      );

    if (section === 'device')
      return (
        <>
          {deviceField && (
            <Form.Field
              label={t('channel.access.device.label')}
              layout="vertical"
              desc={
                ownerMissing ? (
                  <Text fontSize={12} type="warning">
                    {platformId === 'qq'
                      ? t('channel.qq.ownerBinding.deviceOwnerMissing')
                      : t('channel.access.device.ownerMissing')}
                  </Text>
                ) : undefined
              }
            >
              <ChoiceList
                aria-label={t('channel.access.device.label')}
                disabled={disabled}
                options={deviceOptions}
                value={devicePolicy ?? ''}
                onChange={(next) => write({ devicePolicy: next })}
              />
            </Form.Field>
          )}
          {deviceAllowFrom && (
            <SchemaField
              divider
              disabled={disabled}
              emptyOverride={t('channel.access.device.listEmpty')}
              field={deviceAllowFrom}
              hidden={devicePolicy !== 'allowlist'}
              labelOverride={t('channel.access.device.list')}
              parentKey="settings"
              descOverride={
                deviceAllowFrom.managed ? undefined : t('channel.access.device.listHint')
              }
            />
          )}
        </>
      );

    return (
      <>
        {dmField && (
          <Form.Field label={t('channel.access.dm.label')} layout="vertical">
            <ChoiceList
              aria-label={t('channel.access.dm.label')}
              disabled={disabled}
              options={dmOptions}
              value={dmPolicy ?? ''}
              onChange={handleDmPolicy}
            />
          </Form.Field>
        )}
        {allowFrom && (
          <SchemaField
            divider
            descOverride={allowFrom.managed ? undefined : t('channel.access.list.hint')}
            disabled={disabled}
            field={allowFrom}
            hidden={!listVisible}
            parentKey="settings"
            emptyOverride={t(
              dmPolicy === 'pairing'
                ? 'channel.access.list.emptyApproval'
                : 'channel.access.list.emptyListed',
            )}
            labelOverride={t(
              platformId === 'qq' && allowFrom.managed
                ? 'channel.access.list.approved'
                : dmPolicy === 'pairing'
                  ? 'channel.access.list.approved'
                  : 'channel.access.list.listed',
            )}
          />
        )}
        {guestPolicy && (
          <SchemaField divider disabled={disabled} field={guestPolicy} parentKey="settings" />
        )}

        {groupField && (
          <Form.Field
            divider
            label={t('channel.access.group.label')}
            layout="vertical"
            desc={
              hasPeopleList && platformId !== 'qq' ? t('channel.access.group.listNote') : undefined
            }
          >
            <ChoiceList
              aria-label={t('channel.access.group.label')}
              disabled={disabled}
              options={groupOptions}
              value={groupPolicy ?? ''}
              onChange={(next) => write({ groupPolicy: next })}
            />
            {legacyDisabledGroup && (
              <Text fontSize={12} style={{ display: 'block', marginBlockStart: 8 }} type="warning">
                {t('channel.qq.access.group.legacyDisabled')}
              </Text>
            )}
          </Form.Field>
        )}
        {groupAllowFrom && (
          <SchemaField
            divider
            disabled={disabled}
            emptyOverride={platformId === 'qq' ? t('channel.qq.access.group.listEmpty') : undefined}
            field={{ ...groupAllowFrom, visibleWhen: undefined }}
            hidden={!groupListVisible}
            parentKey="settings"
            labelOverride={
              platformId === 'qq' && groupPolicy === 'pairing'
                ? t('channel.qq.access.group.list')
                : undefined
            }
          />
        )}
      </>
    );
  },
);

AccessSection.displayName = 'ChannelAccessSection';
