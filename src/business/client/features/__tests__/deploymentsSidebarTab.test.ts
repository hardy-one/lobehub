import { describe, expect, it } from 'vitest';

import { DEPLOYMENTS_TAB_KEY, shouldShowDeploymentsTab } from '../deploymentsSidebarTab';

describe('shouldShowDeploymentsTab', () => {
  it('shows the tab for a topic while the Lab preference is on', () => {
    expect(shouldShowDeploymentsTab(true, 'topic-1')).toBe(true);
  });

  it('shows no tab while the Lab preference is off', () => {
    expect(shouldShowDeploymentsTab(false, 'topic-1')).toBe(false);
  });

  it('shows no tab without a topic', () => {
    expect(shouldShowDeploymentsTab(true, undefined)).toBe(false);
    expect(shouldShowDeploymentsTab(false, undefined)).toBe(false);
  });
});

describe('DEPLOYMENTS_TAB_KEY', () => {
  // The sidebar persists this key alongside the open tabs.
  it('stays `deployments`', () => {
    expect(DEPLOYMENTS_TAB_KEY).toBe('deployments');
  });
});
