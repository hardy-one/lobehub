/** `getExisting`'s answer for this artifact in this topic. */
export interface ArtifactDeploymentSummary {
  id: string;
  identifier: string;
  kind: string;
  outdated: boolean;
  publicUrl: string;
  revision: number;
  status: 'offline' | 'published';
  title: string | null;
  updatedAt: string;
}

export interface ArtifactDeploymentTarget {
  enabled: boolean;
  identifier: string;
  messageId?: string;
  topicId?: string;
}

/**
 * Publishing reads the artifact back out of its message, so the card needs the message id
 * as much as it needs the identifier.
 */
export function isArtifactDeploymentReady({
  enabled,
  identifier,
  messageId,
  topicId,
}: ArtifactDeploymentTarget): boolean {
  return enabled && !!topicId && !!identifier && !!messageId;
}

export type ArtifactDeploymentCardState =
  | { status: 'hidden' }
  | { status: 'pending' }
  | { status: 'publish'; disabled: boolean }
  | { status: 'published'; outdated: boolean };

export interface ArtifactDeploymentCardInput {
  deployment?: ArtifactDeploymentSummary;
  isArtifactTagClosed: boolean;
  isLoading: boolean;
  target: ArtifactDeploymentTarget;
}

/** The row the card renders, if it renders one at all. */
export function resolveArtifactDeploymentCardState({
  deployment,
  isArtifactTagClosed,
  isLoading,
  target,
}: ArtifactDeploymentCardInput): ArtifactDeploymentCardState {
  if (!isArtifactDeploymentReady(target)) return { status: 'hidden' };

  // Hold the row until the first answer arrives: showing "Publish" for an artifact that
  // is already live would offer a no-op re-publish on every card mount.
  if (isLoading && !deployment) return { status: 'pending' };

  if (!deployment) return { status: 'publish', disabled: !isArtifactTagClosed };

  return { status: 'published', outdated: deployment.outdated };
}
