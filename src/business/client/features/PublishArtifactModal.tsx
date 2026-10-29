'use client';

import { ArtifactType } from '@lobechat/types';
import { errorMessageFrom } from '@lobechat/utils/error';
import {
  Button,
  createModal,
  createStaticStyles,
  cssVar,
  Flexbox,
  Icon,
  Spin,
  Text,
  toast,
  useModalContext,
} from '@lobehub/ui';
import { t as translate } from 'i18next';
import { CheckIcon, CircleAlertIcon, CircleIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  ArtifactSiteBuildError,
  buildReactArtifactSite,
} from '@/features/ArtifactDeployment/buildArtifactSite';
import { mutate } from '@/libs/swr';
import { lambdaClient } from '@/libs/trpc/client';

import { artifactDeploymentKeys } from './artifactDeploymentKeys';

/**
 * The React pipeline's steps. `reading` is the build's tail (collecting the emitted
 * files), so the UI folds it into the build step rather than showing a fourth one.
 */
const PHASE_STEPS = ['installing', 'building', 'uploading'] as const;
type PublishStep = (typeof PHASE_STEPS)[number];

type ArtifactPublishPhase = 'installing' | 'building' | 'reading' | 'uploading';

/** Build output kept for the failure view, mirroring the builder's own log tail. */
const LOG_TAIL_LINES = 20;

const stepOf = (phase: ArtifactPublishPhase): PublishStep =>
  phase === 'uploading' ? 'uploading' : phase === 'installing' ? 'installing' : 'building';

export interface PublishArtifactInput {
  identifier: string;
  /** The message the artifact came from — the server reads an HTML artifact out of it. */
  messageId: string;
  /** React source, read from the artifact's message — the build runs in the browser. */
  source?: string;
  title?: string;
  topicId: string;
  type?: string;
}

interface PublishArtifactModalProps {
  /** Lab preference, needed to revalidate the same keys the card and panel read. */
  enabled: boolean;
  input: PublishArtifactInput;
  /** A first publish warns about the public URL; re-publishing a known artifact does not. */
  requireConfirm: boolean;
}

interface PublishHooks {
  onLog?: (line: string) => void;
  onPhase?: (phase: ArtifactPublishPhase) => void;
}

const styles = createStaticStyles(({ css, cssVar }) => ({
  log: css`
    overflow: auto;

    max-height: 180px;
    margin: 0;
    padding: 8px;
    border-radius: ${cssVar.borderRadius};

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    line-height: 1.5;
    word-break: break-all;
    white-space: pre-wrap;

    background: ${cssVar.colorFillQuaternary};
  `,
  step: css`
    color: ${cssVar.colorTextTertiary};
  `,
}));

/**
 * Build the artifact's React source in the browser, upload the emitted site and commit it.
 * Only React artifacts take this path: an HTML artifact's source is already in the topic,
 * so the server extracts it itself.
 */
const uploadReactArtifact = async (input: PublishArtifactInput, hooks: PublishHooks) => {
  const startedAt = Date.now();

  const { files } = await buildReactArtifactSite({
    onLog: hooks.onLog,
    onPhase: hooks.onPhase,
    source: input.source ?? '',
    title: input.title,
  });

  const upload = await lambdaClient.market.deployments.prepareWorkspaceHtmlUpload.mutate({
    files: files.map((file) => ({
      contentType: file.contentType,
      path: file.path,
      sizeBytes: file.bytes.byteLength,
    })),
    identifier: input.identifier,
    kind: 'react',
    title: input.title,
    topicId: input.topicId,
  });

  hooks.onPhase?.('uploading');

  const builtByPath = new Map(files.map((file) => [file.path, file]));

  await Promise.all(
    upload.files.map(async (target) => {
      const file = builtByPath.get(target.path);
      if (!file) throw new Error(`The build produced no file for ${target.path}`);

      const response = await fetch(target.uploadUrl, {
        // Re-wrap the view so its backing store is a plain ArrayBuffer, which is
        // what BodyInit accepts; the Blob also carries the content type the object
        // store should record.
        body: new Blob([new Uint8Array(file.bytes)], { type: file.contentType }),
        headers: target.headers,
        method: 'PUT',
      });
      if (!response.ok) {
        throw new Error(`Uploading ${target.path} failed with status ${response.status}`);
      }
    }),
  );

  return lambdaClient.market.deployments.commitWorkspaceHtmlUpload.mutate({
    buildMs: Date.now() - startedAt,
    entry: 'index.html',
    identifier: input.identifier,
    kind: 'react',
    manifest: Object.fromEntries(
      files.map((file) => [
        file.path,
        { contentType: file.contentType, size: file.bytes.byteLength },
      ]),
    ),
    messageId: input.messageId,
    source: input.source,
    title: input.title,
    topicId: input.topicId,
    uploadId: upload.uploadId,
  });
};

const publishArtifactDeployment = async (
  input: PublishArtifactInput,
  { enabled, ...hooks }: PublishHooks & { enabled: boolean },
) => {
  if (input.type === ArtifactType.React && !input.source) {
    throw new Error('This React artifact has no source to build');
  }

  const deployment =
    input.type === ArtifactType.React
      ? await uploadReactArtifact(input, hooks)
      : await lambdaClient.market.deployments.publishArtifact.mutate({
          identifier: input.identifier,
          messageId: input.messageId,
          topicId: input.topicId,
        });

  // Both surfaces read this deployment; refresh them together so the panel does not
  // keep showing the revision the publish just replaced.
  await Promise.all([
    mutate(artifactDeploymentKeys.existing(input.topicId, input.identifier, enabled)),
    mutate(artifactDeploymentKeys.listByTopic(input.topicId, enabled)),
  ]);

  return deployment;
};

const PublishArtifactModal = ({ enabled, input, requireConfirm }: PublishArtifactModalProps) => {
  const { t } = useTranslation(['portal', 'chat', 'common']);
  const { close } = useModalContext();
  const startedRef = useRef(false);
  const [started, setStarted] = useState(!requireConfirm);
  const [publishing, setPublishing] = useState(false);
  const [phase, setPhase] = useState<ArtifactPublishPhase>();
  const [error, setError] = useState<{ logs: string[]; message?: string }>();

  const isReact = input.type === ArtifactType.React;

  const run = useCallback(async () => {
    setStarted(true);
    setPublishing(true);
    setError(undefined);
    setPhase(isReact ? 'installing' : undefined);

    // Collected locally so a line of build output does not re-render the modal.
    const logs: string[] = [];

    try {
      await publishArtifactDeployment(input, {
        enabled,
        onLog: (line) => logs.push(line),
        onPhase: setPhase,
      });
      toast.success(t('artifacts.deploy.success'));
      close();
    } catch (cause) {
      setError({
        logs: cause instanceof ArtifactSiteBuildError ? cause.logs : logs.slice(-LOG_TAIL_LINES),
        message: errorMessageFrom(cause) ?? undefined,
      });
    } finally {
      setPublishing(false);
    }
  }, [close, enabled, input, isReact, t]);

  useEffect(() => {
    if (requireConfirm || startedRef.current) return;
    startedRef.current = true;
    void run();
  }, [requireConfirm, run]);

  if (!started) {
    return (
      <Flexbox gap={8} paddingBlock={16} paddingInline={16}>
        <Text weight={500}>{t('artifacts.deploy.confirm.title')}</Text>
        <Text type={'secondary'}>{t('artifacts.deploy.confirm.content')}</Text>
        <Text type={'secondary'}>{t('artifacts.deploy.confirm.note')}</Text>
        <Flexbox horizontal gap={8} justify={'flex-end'} paddingBlock={'8px 0'}>
          <Button onClick={close}>{t('cancel', { ns: 'common' })}</Button>
          <Button type={'primary'} onClick={() => void run()}>
            {t('artifacts.deploy.confirm.action')}
          </Button>
        </Flexbox>
      </Flexbox>
    );
  }

  const activeStep = phase ? stepOf(phase) : undefined;
  const activeIndex = activeStep ? PHASE_STEPS.indexOf(activeStep) : -1;

  return (
    <Flexbox gap={16} paddingBlock={16} paddingInline={16}>
      {error ? (
        <Flexbox gap={8}>
          <Flexbox horizontal align={'center'} gap={8}>
            <Icon icon={CircleAlertIcon} style={{ color: cssVar.colorError }} />
            <Text weight={500}>{t('artifacts.deploy.failed')}</Text>
          </Flexbox>
          {error.message && <Text type={'secondary'}>{error.message}</Text>}
        </Flexbox>
      ) : (
        !isReact && <Text type={'secondary'}>{t('artifacts.deploy.publish')}</Text>
      )}

      {isReact && !error && (
        <Flexbox gap={8}>
          {PHASE_STEPS.map((step, index) => (
            <Flexbox horizontal align={'center'} className={styles.step} gap={8} key={step}>
              {index < activeIndex ? (
                <Icon icon={CheckIcon} />
              ) : index === activeIndex ? (
                <Spin size={'small'} />
              ) : (
                <Icon icon={CircleIcon} />
              )}
              <Text type={index === activeIndex ? undefined : 'secondary'}>
                {t(`artifacts.deploy.phase.${step}`)}
              </Text>
            </Flexbox>
          ))}
        </Flexbox>
      )}

      {error && error.logs.length > 0 && (
        <Flexbox gap={4}>
          <Text fontSize={12} type={'secondary'}>
            {t('chat:resource.artifacts.buildLog.title')}
          </Text>
          <pre className={styles.log}>{error.logs.join('\n')}</pre>
        </Flexbox>
      )}

      <Flexbox horizontal gap={8} justify={'flex-end'}>
        {error && (
          <Button disabled={publishing} onClick={() => void run()}>
            {t('chat:resource.artifacts.retryLoad')}
          </Button>
        )}
        <Button onClick={close}>{t('close', { ns: 'common' })}</Button>
      </Flexbox>
    </Flexbox>
  );
};

/** Open the publish flow: confirmation, then the three-step build-and-upload progress. */
export const openPublishArtifactModal = (props: PublishArtifactModalProps) =>
  createModal({
    content: <PublishArtifactModal {...props} />,
    footer: null,
    maskClosable: false,
    styles: { content: { minHeight: 0, overflow: 'hidden', padding: 0 } },
    title: translate('artifacts.deploy.publish', { ns: 'portal' }),
    width: 420,
  });
