import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useLocalFileTag } from './useLocalFileTag.desktop';

const { effectiveState, electronState, searchProjectFilesMock } = vi.hoisted(() => ({
  effectiveState: {
    agencyConfig: undefined as
      | {
          boundDeviceId?: string;
          executionTarget?: 'device' | 'local';
          heterogeneousProvider?: { type: string };
        }
      | undefined,
    isLoading: false,
    workingDirectory: '/local/repo',
  },
  electronState: {
    currentDeviceId: 'local-device',
  },
  searchProjectFilesMock: vi.fn(),
}));

vi.mock('@/services/projectFile', () => ({
  projectFileService: {
    searchProjectFiles: searchProjectFilesMock,
  },
}));

vi.mock('../hooks/useAgentId', () => ({
  useAgentId: () => 'agent-1',
}));

vi.mock('../hooks/useEffectiveAgentConfig', () => ({
  useChatInputEffectiveAgentConfig: () => ({
    config: { agencyConfig: effectiveState.agencyConfig },
    context: { agentId: 'agent-1' },
    executionTargetError: undefined,
    isExecutionTargetLoading: effectiveState.isLoading,
    workspaceScoped: false,
  }),
}));

vi.mock('@/hooks/useEffectiveWorkingDirectory', () => ({
  useEffectiveWorkingDirectory: () => effectiveState.workingDirectory,
}));

vi.mock('@/helpers/gatewayMode', () => ({
  useIsGatewayModeEnabled: () => false,
}));

vi.mock('@/store/electron', () => ({
  useElectronStore: <T>(selector: (state: { gatewayDeviceInfo?: { deviceId: string } }) => T) =>
    selector({ gatewayDeviceInfo: { deviceId: electronState.currentDeviceId } }),
}));

vi.mock('./MentionMenu/LocalFileIcon', () => ({
  default: () => null,
}));

describe('useLocalFileTag.desktop', () => {
  beforeEach(() => {
    effectiveState.agencyConfig = undefined;
    effectiveState.isLoading = false;
    effectiveState.workingDirectory = '/local/repo';
    electronState.currentDeviceId = 'local-device';
    searchProjectFilesMock.mockReset();
    searchProjectFilesMock.mockResolvedValue({
      entries: [],
      root: '/local/repo',
      searchedAt: '2026-07-01T00:00:00.000Z',
      source: 'git',
    });
  });

  it('does not pass the local gateway device id for local desktop file search', async () => {
    const { result } = renderHook(() => useLocalFileTag());

    await result.current.searchLocalFiles('button');

    expect(searchProjectFilesMock).toHaveBeenCalledWith({
      deviceId: undefined,
      limit: 20,
      query: 'button',
      scope: '/local/repo',
    });
  });

  it('adds the relative directory tail to the menu description slot', async () => {
    searchProjectFilesMock.mockResolvedValueOnce({
      entries: [
        {
          isDirectory: false,
          name: 'README.md',
          path: '/local/repo/packages/editor/README.md',
          relativePath: 'packages/editor/README.md',
        },
      ],
      root: '/local/repo',
      searchedAt: '2026-07-01T00:00:00.000Z',
      source: 'git',
    });

    const { result } = renderHook(() => useLocalFileTag());

    const items = await result.current.searchLocalFiles('readme');

    expect(items[0]).toMatchObject({
      key: 'local-file-/local/repo/packages/editor/README.md',
      label: 'README.md',
      metadata: {
        description: 'packages/editor/',
        name: 'README.md',
        path: '/local/repo/packages/editor/README.md',
        relativePath: 'packages/editor/README.md',
        type: 'localFile',
      },
    });
  });

  it('passes a remote bound device id for remote file search', async () => {
    effectiveState.agencyConfig = {
      boundDeviceId: 'remote-device',
      executionTarget: 'device',
      heterogeneousProvider: { type: 'claude-code' },
    };
    effectiveState.workingDirectory = '/remote/repo';

    const { result } = renderHook(() => useLocalFileTag());

    await result.current.searchLocalFiles('button');

    expect(searchProjectFilesMock).toHaveBeenCalledWith({
      deviceId: 'remote-device',
      limit: 20,
      query: 'button',
      scope: '/remote/repo',
    });
  });
});
