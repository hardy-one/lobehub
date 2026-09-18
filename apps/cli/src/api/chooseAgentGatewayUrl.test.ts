import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { chooseAgentGatewayUrl } from './chooseAgentGatewayUrl';

const fetchMock = vi.fn();

describe('chooseAgentGatewayUrl', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("takes the deployment's own gateway when it answers", async () => {
    fetchMock.mockResolvedValue({ status: 400 });

    await expect(
      chooseAgentGatewayUrl({
        advertised: ['http://100.76.35.114:8787', 'https://agent-gateway.example.com'],
        configuredUrl: 'https://agent-gateway.example.com',
      }),
    ).resolves.toEqual({ source: 'advertised', url: 'http://100.76.35.114:8787' });
    // The private one answered, so the public fallback is never probed.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the next advertised gateway when the first does not answer', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce({ status: 200 });

    await expect(
      chooseAgentGatewayUrl({
        advertised: ['http://100.76.35.114:8787', 'https://agent-gateway.example.com'],
        configuredUrl: 'https://agent-gateway.example.com',
      }),
    ).resolves.toEqual({ source: 'advertised', url: 'https://agent-gateway.example.com' });
  });

  it('keeps what this machine resolves when the deployment offers nothing', async () => {
    await expect(
      chooseAgentGatewayUrl({ advertised: [], configuredUrl: 'https://agent-gateway.example.com' }),
    ).resolves.toEqual({ source: 'configured', url: 'https://agent-gateway.example.com' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps what this machine resolves when nothing advertised answers', async () => {
    fetchMock.mockRejectedValue(new Error('unreachable'));

    await expect(
      chooseAgentGatewayUrl({
        advertised: ['http://10.0.0.9:8787'],
        configuredUrl: 'https://agent-gateway.example.com',
      }),
    ).resolves.toEqual({ source: 'configured', url: 'https://agent-gateway.example.com' });
  });

  it('reports no gateway when there is nothing to resolve either way', async () => {
    await expect(
      chooseAgentGatewayUrl({ advertised: [], configuredUrl: undefined }),
    ).resolves.toEqual({ source: 'configured', url: undefined });
  });
});
