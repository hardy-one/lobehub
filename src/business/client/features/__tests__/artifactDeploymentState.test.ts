import { describe, expect, it } from 'vitest';

import {
  type ArtifactDeploymentSummary,
  type ArtifactDeploymentTarget,
  isArtifactDeploymentReady,
  resolveArtifactDeploymentCardState,
} from '../artifactDeploymentState';

const target: ArtifactDeploymentTarget = {
  enabled: true,
  identifier: 'artifact-1',
  messageId: 'message-1',
  topicId: 'topic-1',
};

const publishedDeployment: ArtifactDeploymentSummary = {
  id: 'dep-1',
  identifier: 'artifact-1',
  kind: 'html',
  outdated: false,
  publicUrl: 'https://example.com/share/artifact/dep-1',
  revision: 2,
  status: 'published',
  title: 'Demo artifact',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const resolveCard = (
  overrides: Partial<Parameters<typeof resolveArtifactDeploymentCardState>[0]> = {},
) =>
  resolveArtifactDeploymentCardState({
    isArtifactTagClosed: true,
    isLoading: false,
    target,
    ...overrides,
  });

describe('isArtifactDeploymentReady', () => {
  it('is ready with the Lab preference on, a topic, an identifier and the source message', () => {
    expect(isArtifactDeploymentReady(target)).toBe(true);
  });

  it('is not ready while the Lab preference is off', () => {
    expect(isArtifactDeploymentReady({ ...target, enabled: false })).toBe(false);
  });

  it('is not ready without a topic', () => {
    expect(isArtifactDeploymentReady({ ...target, topicId: undefined })).toBe(false);
  });

  it('is not ready without an identifier', () => {
    expect(isArtifactDeploymentReady({ ...target, identifier: '' })).toBe(false);
  });

  it('is not ready without the message the artifact came from', () => {
    expect(isArtifactDeploymentReady({ ...target, messageId: undefined })).toBe(false);
  });
});

describe('resolveArtifactDeploymentCardState', () => {
  it('hides the card while the Lab preference is off', () => {
    expect(resolveCard({ target: { ...target, enabled: false } })).toEqual({ status: 'hidden' });
  });

  it('hides the card without a topic', () => {
    expect(resolveCard({ target: { ...target, topicId: undefined } })).toEqual({
      status: 'hidden',
    });
  });

  it('hides the card without an identifier', () => {
    expect(resolveCard({ target: { ...target, identifier: '' } })).toEqual({ status: 'hidden' });
  });

  it('hides the card without the message the artifact came from', () => {
    expect(resolveCard({ target: { ...target, messageId: undefined } })).toEqual({
      status: 'hidden',
    });
  });

  it('holds the row while the first answer is on its way', () => {
    expect(resolveCard({ isLoading: true })).toEqual({ status: 'pending' });
  });

  it('offers the publish action once the artifact is settled and unpublished', () => {
    expect(resolveCard()).toEqual({ status: 'publish', disabled: false });
  });

  it('disables the publish action while the artifact tag is still streaming', () => {
    expect(resolveCard({ isArtifactTagClosed: false })).toEqual({
      status: 'publish',
      disabled: true,
    });
  });

  it('reports a live deployment that is up to date', () => {
    expect(resolveCard({ deployment: publishedDeployment })).toEqual({
      status: 'published',
      outdated: false,
    });
  });

  it('reports a live deployment whose artifact has moved on', () => {
    expect(resolveCard({ deployment: { ...publishedDeployment, outdated: true } })).toEqual({
      status: 'published',
      outdated: true,
    });
  });

  it('keeps the live deployment on screen while it revalidates', () => {
    expect(resolveCard({ deployment: publishedDeployment, isLoading: true })).toEqual({
      status: 'published',
      outdated: false,
    });
  });
});
