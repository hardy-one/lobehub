'use client';

import { ArtifactType } from '@lobechat/types';
import { artifactShareUrl } from '@lobechat/utils/artifactShare';
import {
  ActionIcon,
  Button,
  confirmModal,
  copyToClipboard,
  type DropdownItem,
  DropdownMenu,
  Flexbox,
  Icon,
  toast,
} from '@lobehub/ui';
import {
  CopyIcon,
  ExternalLinkIcon,
  MoreHorizontalIcon,
  RotateCwIcon,
  TrashIcon,
} from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { lambdaClient } from '@/libs/trpc/client';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import { artifactDeploymentKeys } from './artifactDeploymentKeys';
import {
  type ArtifactDeploymentSummary,
  isArtifactDeploymentReady,
  resolveArtifactDeploymentCardState,
} from './artifactDeploymentState';
import { openPublishArtifactModal } from './PublishArtifactModal';

export interface ArtifactDeploymentActionsProps {
  artifactIdentifier?: string;
  artifactTitle?: string;
  artifactType?: string;
  displayMode?: string;
  isArtifactTagClosed: boolean;
  messageId?: string;
  topicId?: string;
}

export default function ArtifactDeploymentActions({
  artifactIdentifier,
  artifactTitle,
  artifactType,
  isArtifactTagClosed,
  messageId,
  topicId,
}: ArtifactDeploymentActionsProps) {
  const { t } = useTranslation(['portal', 'chat']);
  // Two independent opt-ins: the deployment offers Artifact hosting, and this
  // user turned the experiment on for themselves.
  const labEnabled = useUserStore(labPreferSelectors.enableArtifactDeployment);
  const serverEnabled = useServerConfigStore(serverConfigSelectors.enableArtifactDeployment);
  const enabled = labEnabled && serverEnabled;

  const identifier = artifactIdentifier ?? '';
  const target = { enabled, identifier, messageId, topicId };
  const ready = isArtifactDeploymentReady(target);

  const {
    data,
    isLoading,
    mutate: refresh,
  } = useClientDataSWR<ArtifactDeploymentSummary | null>(
    ready ? artifactDeploymentKeys.existing(topicId!, identifier, enabled) : null,
    () =>
      lambdaClient.market.deployments.getExisting.query({
        identifier,
        topicId: topicId!,
      }),
    { revalidateOnFocus: false },
  );

  const deployment = data ?? undefined;

  const openPublish = useCallback(
    (requireConfirm: boolean) => {
      if (!ready) return;

      openPublishArtifactModal({
        enabled,
        input: {
          identifier,
          messageId: messageId!,
          // Only a React artifact is built here; an HTML artifact's source stays in the
          // topic for the server to extract, so the card never needs to read it.
          source:
            artifactType === ArtifactType.React
              ? chatPortalSelectors.artifactCode(messageId!, identifier)(useChatStore.getState())
              : undefined,
          title: artifactTitle,
          topicId: topicId!,
          type: artifactType,
        },
        requireConfirm,
      });
    },
    [artifactTitle, artifactType, enabled, identifier, messageId, ready, topicId],
  );

  const handleCopy = useCallback(async () => {
    if (!deployment) return;

    await copyToClipboard(artifactShareUrl(location.origin, deployment.id));
    toast.success(t('artifacts.deploy.copySuccess'));
  }, [deployment, t]);

  const handleOpen = useCallback(() => {
    if (!deployment) return;

    window.open(artifactShareUrl(location.origin, deployment.id), '_blank', 'noopener,noreferrer');
  }, [deployment]);

  const handleUnpublish = useCallback(() => {
    if (!deployment || !topicId) return;

    const deploymentId = deployment.id;

    confirmModal({
      content: t('workingPanel.deployments.unpublishConfirm', {
        ns: 'chat',
        title: deployment.title || identifier,
      }),
      okButtonProps: { danger: true },
      okText: t('workingPanel.deployments.unpublish', { ns: 'chat' }),
      onOk: async () => {
        try {
          await lambdaClient.market.deployments.unpublish.mutate({ id: deploymentId });
          toast.success(t('workingPanel.deployments.unpublishSuccess', { ns: 'chat' }));
          await Promise.all([
            refresh(),
            mutate(artifactDeploymentKeys.listByTopic(topicId, enabled)),
          ]);
        } catch {
          toast.error(t('workingPanel.deployments.unpublishFailed', { ns: 'chat' }));
        }
      },
      title: t('workingPanel.deployments.unpublish', { ns: 'chat' }),
    });
  }, [deployment, enabled, identifier, refresh, t, topicId]);

  const menuItems = useMemo<DropdownItem[]>(
    () => [
      {
        icon: <Icon icon={RotateCwIcon} />,
        key: 'republish',
        // Always the action, never the status: "outdated" is reported by the
        // trigger's danger state, and a menu entry has to read as something the
        // user can do.
        label: t('artifacts.deploy.publishNewVersion'),
        onClick: () => openPublish(false),
      },
      {
        danger: true,
        icon: <Icon icon={TrashIcon} />,
        key: 'unpublish',
        label: t('workingPanel.deployments.unpublish', { ns: 'chat' }),
        onClick: handleUnpublish,
      },
    ],
    [handleUnpublish, openPublish, t],
  );

  const card = resolveArtifactDeploymentCardState({
    deployment,
    isArtifactTagClosed,
    isLoading,
    target,
  });

  if (card.status === 'hidden' || card.status === 'pending') return null;

  if (card.status === 'publish') {
    return (
      <Button
        disabled={card.disabled}
        size={'small'}
        type={'primary'}
        onClick={() => openPublish(true)}
      >
        {t('artifacts.deploy.publish')}
      </Button>
    );
  }

  return (
    <Flexbox horizontal align={'center'} gap={4}>
      <Button
        icon={<Icon icon={ExternalLinkIcon} />}
        size={'small'}
        type={'text'}
        onClick={handleOpen}
      >
        {t('artifacts.deploy.open')}
      </Button>
      <ActionIcon
        aria-label={t('artifacts.deploy.copy')}
        icon={CopyIcon}
        size={'small'}
        title={t('artifacts.deploy.copy')}
        onClick={() => void handleCopy()}
      />
      <DropdownMenu items={menuItems} placement={'bottomRight'}>
        <ActionIcon
          active={card.outdated}
          aria-label={t('moreMenu.trigger')}
          danger={card.outdated}
          icon={MoreHorizontalIcon}
          size={'small'}
          title={card.outdated ? t('artifacts.deploy.outdated') : t('moreMenu.trigger')}
        />
      </DropdownMenu>
    </Flexbox>
  );
}
