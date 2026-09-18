import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { chooseServerUrl } from './chooseServerUrl';

const fetchMock = vi.fn();

describe('chooseServerUrl', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses an advertised address it can reach, and says so', async () => {
    fetchMock.mockResolvedValue({ status: 401 });

    await expect(
      chooseServerUrl({
        advertised: ['http://100.76.35.114:3210'],
        configuredUrl: 'https://lobe.example.com',
      }),
    ).resolves.toEqual({ source: 'advertised', url: 'http://100.76.35.114:3210' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://100.76.35.114:3210/trpc/lambda',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('keeps the configured URL when the advertised one does not answer', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(
      chooseServerUrl({
        advertised: ['http://100.76.35.114:3210'],
        configuredUrl: 'https://lobe.example.com',
      }),
    ).resolves.toEqual({ source: 'configured', url: 'https://lobe.example.com' });
  });

  it('keeps the configured URL when nothing is advertised', async () => {
    await expect(
      chooseServerUrl({ advertised: [], configuredUrl: 'https://lobe.example.com' }),
    ).resolves.toEqual({ source: 'configured', url: 'https://lobe.example.com' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('probes an advertised address even when it is the configured one', async () => {
    // Observed in production: the address in use *is* the one verified last time,
    // so treating that equality as "nothing to check" left it unverified and
    // reported it as unreachable while still dialling it.
    fetchMock.mockResolvedValue({ status: 200 });

    await expect(
      chooseServerUrl({
        advertised: ['https://lobe.example.com'],
        configuredUrl: 'https://lobe.example.com',
      }),
    ).resolves.toEqual({ source: 'advertised', url: 'https://lobe.example.com' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('takes the first reachable address when several are offered', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('unreachable'))
      .mockResolvedValueOnce({ status: 200 });

    await expect(
      chooseServerUrl({
        advertised: ['http://10.0.0.9:3210', 'http://10.0.0.5:3210'],
        configuredUrl: 'https://lobe.example.com',
      }),
    ).resolves.toEqual({ source: 'advertised', url: 'http://10.0.0.5:3210' });
  });
});
