'use client';

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import ArtifactDeploymentsPanel from './ArtifactDeploymentsPanel';
import { DEPLOYMENTS_TAB_KEY, shouldShowDeploymentsTab } from './deploymentsSidebarTab';

export interface BusinessWorkingSidebarTab {
  key: string;
  label: ReactNode;
  pane: ReactNode;
}

export interface BusinessWorkingSidebarTabsContext {
  activeAgentId?: string;
  topicId?: string;
}

export function useBusinessWorkingSidebarTabs(
  context: BusinessWorkingSidebarTabsContext,
): BusinessWorkingSidebarTab[] {
  const { t } = useTranslation('chat');
  // Two independent opt-ins: the deployment offers Artifact hosting, and this
  // user turned the experiment on for themselves.
  const labEnabled = useUserStore(labPreferSelectors.enableArtifactDeployment);
  const serverEnabled = useServerConfigStore(serverConfigSelectors.enableArtifactDeployment);
  const enabled = labEnabled && serverEnabled;
  const { topicId } = context;

  if (!shouldShowDeploymentsTab(enabled, topicId)) return [];

  return [
    {
      key: DEPLOYMENTS_TAB_KEY,
      label: t('workingPanel.deployments.tab'),
      pane: <ArtifactDeploymentsPanel topicId={topicId} />,
    },
  ];
}
