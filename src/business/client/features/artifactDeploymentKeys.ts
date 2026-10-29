/**
 * SWR keys for artifact deployments.
 *
 * The artifact card and the working-sidebar panel must build the same key for the same
 * deployment, or publishing in one leaves the other showing a stale state. `enabled` is
 * part of the key so turning the Lab preference off drops the cached response instead of
 * feeding a surface that should no longer exist.
 */
export const artifactDeploymentKeys = {
  existing: (topicId: string, identifier: string, enabled: boolean) =>
    ['artifactDeployment:existing', enabled, topicId, identifier] as const,
  listByTopic: (topicId: string, enabled: boolean) =>
    ['artifactDeployment:listByTopic', enabled, topicId] as const,
};
