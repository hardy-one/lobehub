import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { chooseServerUrl } from './chooseServerUrl';

const { fetchMock, urlsMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  urlsMock: vi.fn(),
}));

vi.mock('./runtimeEndpoints', () => ({ fetchAdvertisedServerUrls: urlsMock }));

describe('chooseServerUrl', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    urlsMock.mockReset();
    urlsMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses an advertised address it can reach, and says so', async () => {
    urlsMock.mockResolvedValue(['http://100.76.35.114:3210']);
    fetchMock.mockResolvedValue({ status: 401 });

    await expect(chooseServerUrl({ configuredUrl: 'https://lobe.example.com' })).resolves.toEqual({
      source: 'advertised',
      url: 'http://100.76.35.114:3210',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://100.76.35.114:3210/trpc/lambda',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('keeps the configured URL when the advertised one does not answer', async () => {
    urlsMock.mockResolvedValue(['http://100.76.35.114:3210']);
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(chooseServerUrl({ configuredUrl: 'https://lobe.example.com' })).resolves.toEqual({
      source: 'configured',
      url: 'https://lobe.example.com',
    });
  });

  it('keeps the configured URL when nothing is advertised', async () => {
    await expect(chooseServerUrl({ configuredUrl: 'https://lobe.example.com' })).resolves.toEqual({
      source: 'configured',
      url: 'https://lobe.example.com',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('probes an advertised address even when it is the configured one', async () => {
    // Observed in production: the address in use *is* the one verified last time,
    // so treating that equality as "nothing to check" left it unverified and
    // reported it as unreachable while still dialling it.
    urlsMock.mockResolvedValue(['https://lobe.example.com']);
    fetchMock.mockResolvedValue({ status: 200 });

    await expect(chooseServerUrl({ configuredUrl: 'https://lobe.example.com' })).resolves.toEqual({
      source: 'advertised',
      url: 'https://lobe.example.com',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('takes the first reachable address when several are offered', async () => {
    urlsMock.mockResolvedValue(['http://10.0.0.9:3210', 'http://10.0.0.5:3210']);
    fetchMock
      .mockRejectedValueOnce(new Error('unreachable'))
      .mockResolvedValueOnce({ status: 200 });

    await expect(chooseServerUrl({ configuredUrl: 'https://lobe.example.com' })).resolves.toEqual({
      source: 'advertised',
      url: 'http://10.0.0.5:3210',
    });
  });
});
