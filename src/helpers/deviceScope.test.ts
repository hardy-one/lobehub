import { describe, expect, it } from 'vitest';

import { resolveBrowserDeviceScope } from './deviceScope';

const workspace = {
  canManage: true,
  currentDeviceId: 'my-device',
  preferenceWorkspaceId: 'workspace-a',
  workspaceId: 'workspace-a',
  visibility: 'public' as const,
};

describe('browser runtime device scope', () => {
  it('defaults personal agents to the personal pool', () => {
    expect(resolveBrowserDeviceScope({ canManage: true })).toBe('personal');
  });
  it('does not treat a shared local setting as the member own selection', () => {
    expect(
      resolveBrowserDeviceScope({ ...workspace, agencyConfig: { executionTarget: 'local' } }),
    ).toBe('workspace');
  });
  it('accepts an explicit personal local override from the current workspace', () => {
    expect(
      resolveBrowserDeviceScope({ ...workspace, deviceOverride: { executionTarget: 'local' } }),
    ).toBe('personal');
  });
  it.each([null, 'workspace-b'])(
    'ignores unhydrated or other-workspace overrides (%s)',
    (preferenceWorkspaceId) => {
      expect(
        resolveBrowserDeviceScope({
          ...workspace,
          preferenceWorkspaceId,
          deviceOverride: { executionTarget: 'local' },
        }),
      ).toBe('workspace');
    },
  );
  it('honors a fixed selection policy for non-managers', () => {
    expect(
      resolveBrowserDeviceScope({
        ...workspace,
        canManage: false,
        agencyConfig: { executionTarget: 'device', executionTargetSelectionPolicy: 'fixed' },
        deviceOverride: { executionTarget: 'local' },
      }),
    ).toBe('workspace');
  });
  it('does not redirect a topic bound to another machine to this desktop', () => {
    expect(
      resolveBrowserDeviceScope({
        ...workspace,
        topicDeviceId: 'other-device',
        deviceOverride: { executionTarget: 'local' },
      }),
    ).toBe('workspace');
  });
});
