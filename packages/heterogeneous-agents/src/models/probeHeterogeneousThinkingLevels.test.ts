import { afterEach, describe, expect, it, vi } from 'vitest';

import { PiRpcConnectionError } from '../rpc/piRpcClient';
import { probeHeterogeneousThinkingLevels } from './probeHeterogeneousThinkingLevels';

const { probePiThinkingLevelsMock, resolveHeteroSpawnCommandMock } = vi.hoisted(() => ({
  probePiThinkingLevelsMock: vi.fn(),
  resolveHeteroSpawnCommandMock: vi.fn(),
}));

vi.mock('../rpc/probePiThinkingLevels', () => ({
  probePiThinkingLevels: probePiThinkingLevelsMock,
}));
vi.mock('../spawn/resolveCliCommand', () => ({
  resolveHeteroSpawnCommand: resolveHeteroSpawnCommandMock,
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('probeHeterogeneousThinkingLevels', () => {
  it('answers unsupported_client for CLIs that do not expose levels', async () => {
    const result = await probeHeterogeneousThinkingLevels({ type: 'opencode' });

    expect(result).toMatchObject({ error: { code: 'unsupported_client' }, status: 'error' });
    expect(probePiThinkingLevelsMock).not.toHaveBeenCalled();
  });

  it('merges the resolver PATH and returns the probed levels', async () => {
    resolveHeteroSpawnCommandMock.mockResolvedValue({ command: '/opt/pi', pathEnv: '/opt/bin' });
    probePiThinkingLevelsMock.mockResolvedValue({
      levels: ['off', 'high'],
    });

    const result = await probeHeterogeneousThinkingLevels({
      args: ['--model', 'm-1'],
      env: { PATH: '/usr/bin' },
      type: 'pi',
    });

    expect(probePiThinkingLevelsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ['--model', 'm-1'],
        commandPath: '/opt/pi',
        env: expect.objectContaining({ PATH: expect.stringContaining('/opt/bin') }),
      }),
    );
    expect(result).toMatchObject({
      levels: ['off', 'high'],
      status: 'success',
    });
  });

  it('classifies a Pi that is too old for RPC as unsupported_client', async () => {
    resolveHeteroSpawnCommandMock.mockResolvedValue({ command: 'pi' });
    probePiThinkingLevelsMock.mockRejectedValue(
      new PiRpcConnectionError('Pi >= 0.80.5 (stable) is required; upgrade pi to use RPC.', {
        phase: 'spawn',
      }),
    );

    const result = await probeHeterogeneousThinkingLevels({ type: 'pi' });

    expect(result).toMatchObject({ error: { code: 'unsupported_client' }, status: 'error' });
  });

  it('reports a missing CLI as cli_not_found', async () => {
    resolveHeteroSpawnCommandMock.mockResolvedValue({ command: 'pi' });
    probePiThinkingLevelsMock.mockRejectedValue(
      Object.assign(new Error('spawn pi ENOENT'), { code: 'ENOENT' }),
    );

    const result = await probeHeterogeneousThinkingLevels({ type: 'pi' });

    expect(result).toMatchObject({ error: { code: 'cli_not_found' }, status: 'error' });
  });
});
