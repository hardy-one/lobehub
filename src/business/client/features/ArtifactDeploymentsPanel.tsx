'use client';

import { artifactShareUrl } from '@lobechat/utils/artifactShare';
import {
  ActionIcon,
  Button,
  Center,
  confirmModal,
  copyToClipboard,
  createStaticStyles,
  Empty,
  Flexbox,
  Tag,
  Text,
  toast,
} from '@lobehub/ui';
import {
  CopyIcon,
  ExternalLinkIcon,
  GlobeIcon,
  HistoryIcon,
  RefreshCwIcon,
  TrashIcon,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { lambdaClient } from '@/libs/trpc/client';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';
import { oneLineEllipsis } from '@/styles';

import { artifactDeploymentKeys } from './artifactDeploymentKeys';

/** `listByTopic`'s row for this topic. */
interface TopicDeployment {
  currentRevision: number;
  id: string;
  identifier: string;
  kind: string;
  publicUrl: string;
  status: string;
  title: string | null;
  updatedAt: string;
}

/**
 * `listByTopic` reports the stored lifecycle states; the panel's copy names them.
 * Anything unrecognised renders without a tag rather than as a raw enum value.
 */
const STATUS_LABEL_KEYS = {
  active: 'workingPanel.deployments.status.active',
  building: 'workingPanel.deployments.status.building',
  failed: 'workingPanel.deployments.status.failed',
  offline: 'workingPanel.deployments.status.unpublished',
  online: 'workingPanel.deployments.status.online',
  published: 'workingPanel.deployments.status.online',
  publishing: 'workingPanel.deployments.status.publishing',
  unpublished: 'workingPanel.deployments.status.unpublished',
} as const;

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    padding: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
  container: css`
    min-height: 0;
    padding-block: 12px;
    padding-inline: 12px;
  `,
  revision: css`
    padding-block: 4px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorFillTertiary};
  `,
}));

interface RevisionListProps {
  deployment: TopicDeployment;
  enabled: boolean;
  topicId: string;
}

/**
 * The revisions a deployment can be switched back to. `listByTopic` only reports the
 * live one, so the list runs down from it: revisions are numbered from the first
 * publish, and the server rejects any number it no longer holds.
 */
const RevisionList = ({ deployment, enabled, topicId }: RevisionListProps) => {
  const { t } = useTranslation('chat');
  const [restoring, setRestoring] = useState<number>();

  const restore = async (revision: number) => {
    setRestoring(revision);
    try {
      await lambdaClient.market.deployments.setCurrentRevision.mutate({
        id: deployment.id,
        revision,
      });
      toast.success(t('resource.artifacts.history.restoreSuccess', { from: revision }));
      await mutate(artifactDeploymentKeys.listByTopic(topicId, enabled));
    } catch {
      toast.error(t('resource.artifacts.history.restoreError'));
    } finally {
      setRestoring(undefined);
    }
  };

  const revisions = Array.from(
    { length: deployment.currentRevision },
    (_, index) => deployment.currentRevision - index,
  );

  return (
    <Flexbox gap={4}>
      {revisions.map((revision) => (
        <Flexbox
          horizontal
          align={'center'}
          className={styles.revision}
          gap={8}
          justify={'space-between'}
          key={revision}
        >
          <Text type={revision === deployment.currentRevision ? undefined : 'secondary'}>
            {`v${revision}`}
          </Text>
          {revision === deployment.currentRevision ? (
            <Tag size={'small'}>{t('resource.artifacts.history.currentRevision')}</Tag>
          ) : (
            <Button
              loading={restoring === revision}
              size={'small'}
              type={'text'}
              onClick={() => void restore(revision)}
            >
              {t('resource.artifacts.history.restoreTo', { revision })}
            </Button>
          )}
        </Flexbox>
      ))}
    </Flexbox>
  );
};

interface DeploymentCardProps {
  deployment: TopicDeployment;
  enabled: boolean;
  topicId: string;
}

const DeploymentCard = ({ deployment, enabled, topicId }: DeploymentCardProps) => {
  const { t } = useTranslation('chat');
  const [showHistory, setShowHistory] = useState(false);

  const listKey = artifactDeploymentKeys.listByTopic(topicId, enabled);
  const url = artifactShareUrl(location.origin, deployment.id);
  const statusKey = STATUS_LABEL_KEYS[deployment.status as keyof typeof STATUS_LABEL_KEYS];

  const handleCopy = async () => {
    await copyToClipboard(url);
    toast.success(t('workingPanel.deployments.copySuccess'));
  };

  const handleUnpublish = () => {
    confirmModal({
      content: t('workingPanel.deployments.unpublishConfirm', {
        title: deployment.title || deployment.identifier,
      }),
      okButtonProps: { danger: true },
      okText: t('workingPanel.deployments.unpublish'),
      onOk: async () => {
        try {
          await lambdaClient.market.deployments.unpublish.mutate({ id: deployment.id });
          toast.success(t('workingPanel.deployments.unpublishSuccess'));
          await mutate(listKey);
        } catch {
          toast.error(t('workingPanel.deployments.unpublishFailed'));
        }
      },
      title: t('workingPanel.deployments.unpublish'),
    });
  };

  return (
    <Flexbox className={styles.card} gap={8}>
      <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
        <Text className={oneLineEllipsis} weight={500}>
          {deployment.title || deployment.identifier}
        </Text>
        {statusKey && <Tag size={'small'}>{t(statusKey)}</Tag>}
      </Flexbox>
      <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
        <Text fontSize={12} type={'secondary'}>
          {`v${deployment.currentRevision}`}
        </Text>
        <Flexbox horizontal gap={2}>
          <ActionIcon
            icon={ExternalLinkIcon}
            size={'small'}
            title={t('workingPanel.deployments.open')}
            onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
          />
          <ActionIcon
            icon={CopyIcon}
            size={'small'}
            title={t('workingPanel.deployments.copy')}
            onClick={() => void handleCopy()}
          />
          <ActionIcon
            active={showHistory}
            disabled={deployment.currentRevision <= 1}
            icon={HistoryIcon}
            size={'small'}
            title={t('workingPanel.deployments.history')}
            onClick={() => setShowHistory((current) => !current)}
          />
          <ActionIcon
            danger
            icon={TrashIcon}
            size={'small'}
            title={t('workingPanel.deployments.unpublish')}
            onClick={handleUnpublish}
          />
        </Flexbox>
      </Flexbox>
      {showHistory && <RevisionList deployment={deployment} enabled={enabled} topicId={topicId} />}
    </Flexbox>
  );
};

/**
 * The Deployments tab: every artifact published from this topic, with the release each
 * one is currently serving.
 */
const ArtifactDeploymentsPanel = ({ topicId }: { topicId: string }) => {
  const { t } = useTranslation('chat');
  const enabled = useUserStore(labPreferSelectors.enableArtifactDeployment);

  const {
    data,
    error,
    isLoading,
    isValidating,
    mutate: refresh,
  } = useClientDataSWR<TopicDeployment[]>(
    enabled && topicId ? artifactDeploymentKeys.listByTopic(topicId, enabled) : null,
    () => lambdaClient.market.deployments.listByTopic.query({ topicId }),
    { revalidateOnFocus: false },
  );

  const deployments = data ?? [];

  return (
    <Flexbox className={styles.container} flex={1} gap={12} height={'100%'} width={'100%'}>
      <Flexbox horizontal align={'center'} justify={'space-between'}>
        <Text weight={500}>{t('workingPanel.deployments.title')}</Text>
        <ActionIcon
          icon={RefreshCwIcon}
          loading={isValidating}
          size={'small'}
          title={t('workingPanel.deployments.refresh')}
          onClick={() => void refresh()}
        />
      </Flexbox>
      <AsyncBoundary
        data={data}
        error={error}
        isEmpty={deployments.length === 0}
        isLoading={isLoading}
        empty={
          <Center flex={1} paddingBlock={24}>
            <Empty description={t('workingPanel.deployments.empty')} icon={GlobeIcon} />
          </Center>
        }
        onRetry={() => void refresh()}
      >
        <Flexbox gap={8}>
          {deployments.map((deployment) => (
            <DeploymentCard
              deployment={deployment}
              enabled={enabled}
              key={deployment.id}
              topicId={topicId}
            />
          ))}
        </Flexbox>
      </AsyncBoundary>
    </Flexbox>
  );
};

export default ArtifactDeploymentsPanel;
