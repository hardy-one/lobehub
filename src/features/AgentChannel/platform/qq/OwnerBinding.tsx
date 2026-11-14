'use client';

import { isMaskedBotCredential } from '@lobechat/const';
// oxlint-disable-next-line stylex-migration/no-emotion-styles -- the QQ settings task requires the repository's createStaticStyles and cssVar styling API.
import { Button, CopyButton, createStaticStyles, Flexbox, Text, toast } from '@lobehub/ui';
import { Form, useFormInstance, useWatch } from '@lobehub/ui/form';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';

import type { PlatformSettingsFieldExtrasProps } from '../types';
import { isOwnerBindingComplete, syncOwnerBindingUserId } from './ownerBindingFormSync';

const styles = createStaticStyles(({ css, cssVar }) => ({
  code: css`
    font-family: ${cssVar.fontFamilyCode};
    overflow-wrap: anywhere;
  `,
  ownerId: css`
    max-width: min(100%, 360px);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

interface ActiveBinding {
  applicationId: string;
  code: string;
  expiresAt: number;
  previousBoundAt?: string;
  previousOwnerId?: string;
}

const nonEmptyString = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

/** Generate a QQ owner binding code and reflect the server binding in the live form. */
export const OwnerBinding = ({
  disabled,
  hasConfig,
  onBindingPendingChange,
  onFilled,
  platformId,
  savedCredentials,
  savedValue,
}: PlatformSettingsFieldExtrasProps) => {
  const { t: _t } = useTranslation('agent');
  const t = _t as (key: string, options?: Record<string, unknown>) => string;
  const form = useFormInstance();
  const applicationId = useWatch(form, 'applicationId') as string | undefined;
  const appSecret = useWatch(form, 'credentials.appSecret') as string | undefined;
  const watchedUserId = useWatch(form, 'settings.userId') as string | undefined;
  const [activeBinding, setActiveBinding] = useState<ActiveBinding>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const [expired, setExpired] = useState(false);
  const refreshInFlight = useRef(false);
  const completedBindingRef = useRef<ActiveBinding | undefined>(undefined);

  const appId = applicationId?.trim();
  const currentSecret = appSecret?.trim();
  const savedSecret = nonEmptyString(savedCredentials?.appSecret);
  const hasCurrentSecret = Boolean(currentSecret && !isMaskedBotCredential(currentSecret));
  const credentialsReady = Boolean(appId && (hasCurrentSecret || savedSecret));
  const agentId = useAgentStore((state) => state.activeAgentId);
  const createOwnerBindingCode = useAgentStore((state) => state.createOwnerBindingCode);
  const refreshBotProviders = useAgentStore((state) => state.internal_refreshBotProviders);
  const ownerIdFromStore = useAgentStore((state) => {
    const providers = state.activeAgentId ? state.botProvidersMap[state.activeAgentId] : undefined;
    const targetApplicationId = activeBinding?.applicationId ?? appId;
    const provider = providers?.find(
      (item) => item.platform === platformId && item.applicationId === targetApplicationId,
    );
    return provider?.settings?.userId;
  });

  const ownerBoundAtFromStore = useAgentStore((state) => {
    const providers = state.activeAgentId ? state.botProvidersMap[state.activeAgentId] : undefined;
    const targetApplicationId = activeBinding?.applicationId ?? appId;
    const provider = providers?.find(
      (item) => item.platform === platformId && item.applicationId === targetApplicationId,
    );
    return provider?.settings?.ownerBoundAt;
  });
  const storeOwnerId = nonEmptyString(ownerIdFromStore);
  const ownerId = storeOwnerId ?? nonEmptyString(watchedUserId) ?? nonEmptyString(savedValue);
  const hasOwnerId = Boolean(ownerId);

  const visibleBinding = activeBinding;
  const handleGenerate = useCallback(async () => {
    if (disabled || !hasConfig || !appId || !credentialsReady || loading) return;

    setError(false);
    setRefreshError(false);
    setExpired(false);
    setActiveBinding(undefined);
    completedBindingRef.current = undefined;
    setLoading(true);
    onBindingPendingChange?.(true);

    try {
      const result = await createOwnerBindingCode({ applicationId: appId, platform: platformId });
      setActiveBinding({
        applicationId: appId,
        code: result.code,
        expiresAt: result.expiresAt,
        previousBoundAt: nonEmptyString(ownerBoundAtFromStore),
        previousOwnerId: ownerId,
      });
    } catch {
      onBindingPendingChange?.(false);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [
    appId,
    createOwnerBindingCode,
    credentialsReady,
    disabled,
    hasConfig,
    loading,
    onBindingPendingChange,
    ownerId,
    ownerBoundAtFromStore,
    platformId,
  ]);

  const completeBinding = useCallback(
    (boundOwnerId: string) => {
      if (!activeBinding || completedBindingRef.current === activeBinding) return;

      completedBindingRef.current = activeBinding;
      syncOwnerBindingUserId(
        {
          getSettings: () =>
            (form.getValue('settings') as Record<string, unknown> | undefined) ?? {},
          setSettings: (settings) =>
            form.setValues({ settings: settings as Record<string, {} | undefined> }),
          validate: (names) => form.validate(names),
        },
        boundOwnerId,
        onFilled,
      );
      setActiveBinding(undefined);
      onBindingPendingChange?.(false);
      toast.success(t('channel.qq.ownerBinding.boundSuccess'));
    },
    [activeBinding, form, onBindingPendingChange, onFilled, t],
  );

  useEffect(() => {
    if (!activeBinding) return;

    const refresh = async () => {
      if (Date.now() >= activeBinding.expiresAt) {
        setActiveBinding(undefined);
        setExpired(true);
        setRefreshError(false);
        onBindingPendingChange?.(false);
        return;
      }
      if (!agentId || refreshInFlight.current) return;

      refreshInFlight.current = true;
      try {
        await refreshBotProviders(agentId);
        setRefreshError(false);
        const provider = useAgentStore
          .getState()
          .botProvidersMap[agentId]?.find(
            (item) =>
              item.platform === platformId && item.applicationId === activeBinding.applicationId,
          );
        const currentOwnerId = nonEmptyString(provider?.settings?.userId);
        const currentBoundAt = nonEmptyString(provider?.settings?.ownerBoundAt);
        if (
          currentOwnerId &&
          isOwnerBindingComplete(
            { boundAt: activeBinding.previousBoundAt, ownerId: activeBinding.previousOwnerId },
            { boundAt: currentBoundAt, ownerId: currentOwnerId },
          )
        ) {
          completeBinding(currentOwnerId);
        }
      } catch {
        setRefreshError(true);
      } finally {
        refreshInFlight.current = false;
      }
    };

    void refresh();
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => window.clearInterval(timer);
  }, [
    activeBinding,
    agentId,
    completeBinding,
    onBindingPendingChange,
    platformId,
    refreshBotProviders,
  ]);
  const missingCopy = !hasConfig
    ? 'channel.qq.ownerBinding.saveFirst'
    : !credentialsReady
      ? 'channel.qq.ownerBinding.credentialsRequired'
      : undefined;
  const buttonKey = visibleBinding
    ? 'channel.qq.ownerBinding.regenerate'
    : hasOwnerId
      ? 'channel.qq.ownerBinding.rebind'
      : 'channel.qq.ownerBinding.generate';

  return (
    <Form.Field label={t('channel.qq.ownerBinding.label')} layout="vertical">
      <Flexbox gap={8} style={{ width: '100%' }}>
        {hasOwnerId ? (
          <Flexbox horizontal align="center" gap={8}>
            <Text fontSize={12} type="secondary">
              {t('channel.qq.ownerBinding.boundId')}
            </Text>
            <Text code className={styles.ownerId} title={ownerId}>
              {ownerId}
            </Text>
          </Flexbox>
        ) : (
          <Text fontSize={12} type="secondary">
            {t('channel.qq.ownerBinding.notBound')}
          </Text>
        )}

        {missingCopy && (
          <Text fontSize={12} type="secondary">
            {t(missingCopy)}
          </Text>
        )}
        {expired && (
          <Text fontSize={12} type="secondary">
            {t('channel.qq.ownerBinding.expired')}
          </Text>
        )}
        {error && (
          <Text fontSize={12} role="alert" type="danger">
            {t('channel.qq.ownerBinding.error')}
          </Text>
        )}
        {refreshError && (
          <Text fontSize={12} role="status" type="warning">
            {t('channel.qq.ownerBinding.refreshError')}
          </Text>
        )}

        <Button
          disabled={disabled || !hasConfig || !credentialsReady}
          loading={loading}
          size="small"
          style={{ alignSelf: 'flex-start' }}
          type={visibleBinding ? 'default' : 'primary'}
          onClick={handleGenerate}
        >
          {t(buttonKey)}
        </Button>

        {visibleBinding && (
          <Flexbox gap={8}>
            <Flexbox horizontal align="center" gap={8}>
              <Text code className={styles.code}>
                {visibleBinding.code}
              </Text>
              <CopyButton
                content={visibleBinding.code}
                size="small"
                title={t('channel.qq.ownerBinding.copyCode')}
              />
            </Flexbox>
            <Text fontSize={12}>
              {t('channel.qq.ownerBinding.instruction', { code: visibleBinding.code })}
            </Text>
            <Text fontSize={12} type="secondary">
              {t('channel.qq.ownerBinding.pendingNote')}
            </Text>
            <Text fontSize={12} type="secondary">
              {t('channel.qq.ownerBinding.expiresAt', {
                time: new Date(visibleBinding.expiresAt).toLocaleTimeString(undefined, {
                  hour: '2-digit',
                  minute: '2-digit',
                }),
              })}
            </Text>
          </Flexbox>
        )}
      </Flexbox>
    </Form.Field>
  );
};
