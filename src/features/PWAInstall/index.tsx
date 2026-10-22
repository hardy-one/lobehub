'use client';

import { BRANDING_NAME } from '@lobechat/business-const';
import { memo, useEffect, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { PWA_INSTALL_ID } from '@/const/layoutTokens';
import { usePlatform } from '@/hooks/usePlatform';
import { usePWAInstall } from '@/hooks/usePWAInstall';
import dynamic from '@/libs/next/dynamic';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';

interface PWAInstallElementProps {
  'description'?: string;
  'id'?: string;
  'manifest-url'?: string;
}
const PWA = dynamic<PWAInstallElementProps>(
  () => import('@khmyznikov/pwa-install/dist/pwa-install.react.js'),
  {
    ssr: false,
  },
);

const PWAInstall = memo(() => {
  const { t } = useTranslation('metadata');
  const { canInstall, install } = usePWAInstall();
  const { isPWA, isSupportInstallPWA } = usePlatform();
  const isShowPWAGuide = useUserStore((state) => state.isShowPWAGuide);
  const [hidePWAInstaller, updateSystemStatus] = useGlobalStore((state) => [
    systemStatusSelectors.hidePWAInstaller(state),
    state.updateSystemStatus,
  ]);

  useLayoutEffect(() => {
    // The custom element can otherwise open its own prompt before the app has
    // applied the user's install-guide preference. We trigger it explicitly
    // once the install event is available instead.
    try {
      sessionStorage.setItem('pwa-hide-install', 'true');
    } catch {
      // Storage can be unavailable in private browsing contexts.
    }
  }, []);

  useEffect(() => {
    const pwaInstall = document.getElementById(PWA_INSTALL_ID);
    if (!pwaInstall) return;

    const handleUserChoice = (event: Event) => {
      const message = (event as CustomEvent<{ message?: string }>).detail?.message;
      if (message === 'dismissed') {
        updateSystemStatus({ hidePWAInstaller: true });
      }
    };

    pwaInstall.addEventListener('pwa-user-choice-result-event', handleUserChoice);
    return () => {
      pwaInstall.removeEventListener('pwa-user-choice-result-event', handleUserChoice);
    };
  }, [updateSystemStatus]);

  useEffect(() => {
    if (!canInstall || hidePWAInstaller || !isShowPWAGuide) return;
    install();
  }, [canInstall, hidePWAInstaller, install, isShowPWAGuide]);

  if (isPWA || !isSupportInstallPWA || !isShowPWAGuide || hidePWAInstaller) return null;

  return (
    <PWA
      description={t('chat.description', { appName: BRANDING_NAME })}
      id={PWA_INSTALL_ID}
      manifest-url={'/manifest.webmanifest?v=2'}
    />
  );
});

PWAInstall.displayName = 'PWAInstall';

export default PWAInstall;
