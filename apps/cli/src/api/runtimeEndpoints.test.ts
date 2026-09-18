import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchAdvertisedRuntimeEndpoints } from './runtimeEndpoints';

const { queryMock, clientMock } = vi.hoisted(() => ({
  clientMock: vi.fn(),
  queryMock: vi.fn(),
}));

vi.mock('./client', () => ({ getTrpcClient: clientMock }));

describe('fetchAdvertisedRuntimeEndpoints', () => {
  beforeEach(() => {
    queryMock.mockReset();
    clientMock.mockReset();
    clientMock.mockResolvedValue({
      aiAgent: { heteroRuntimeEndpoints: { query: queryMock } },
    });
  });

  it('returns the addresses the deployment offers, normalized', async () => {
    queryMock.mockResolvedValue({
      agentGatewayUrls: ['http://100.76.35.114:8787/', 'https://agent-gateway.example.com'],
      serverUrls: ['http://100.76.35.114:3210/'],
    });

    await expect(fetchAdvertisedRuntimeEndpoints()).resolves.toEqual({
      agentGatewayUrls: ['http://100.76.35.114:8787', 'https://agent-gateway.example.com'],
      serverUrls: ['http://100.76.35.114:3210'],
    });
  });

  it('reports none when the server offers none', async () => {
    queryMock.mockResolvedValue({ serverUrls: [] });

    await expect(fetchAdvertisedRuntimeEndpoints()).resolves.toEqual({
      agentGatewayUrls: [],
      serverUrls: [],
    });
  });

  it('reports none instead of throwing when the lookup fails', async () => {
    // "The server offers none" and "I could not ask" lead to the same place: the
    // URL this machine is configured with.
    queryMock.mockRejectedValue(new Error('offline'));

    await expect(fetchAdvertisedRuntimeEndpoints()).resolves.toEqual({
      agentGatewayUrls: [],
      serverUrls: [],
    });
  });

  it('gives up on a lookup that takes too long', async () => {
    queryMock.mockImplementation(() => new Promise(() => {}));

    await expect(fetchAdvertisedRuntimeEndpoints({ timeoutMs: 10 })).resolves.toEqual({
      agentGatewayUrls: [],
      serverUrls: [],
    });
  });
});
