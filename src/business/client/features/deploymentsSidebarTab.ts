/**
 * Persisted with the sidebar's open tabs, so it must stay `'deployments'` — renaming the
 * key would drop the tab out of every user's saved selection.
 */
export const DEPLOYMENTS_TAB_KEY = 'deployments';

/**
 * A deployment is scoped to its topic, and the whole surface is behind the Lab preference,
 * so neither state has a tab to show. The predicate narrows `topicId`, which is what lets
 * the caller build the pane without a second null check.
 */
export function shouldShowDeploymentsTab(enabled: boolean, topicId?: string): topicId is string {
  return enabled && !!topicId;
}
