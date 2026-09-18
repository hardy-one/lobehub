import { beforeEach, describe, expect, it, vi } from 'vitest';

import { pickDeviceServerUrl } from './deviceServerUrl';

describe('pickDeviceServerUrl', () => {
  const probe = vi.fn();

  beforeEach(() => {
    probe.mockReset();
  });

  it('takes an advertised address this machine can reach', async () => {
    probe.mockResolvedValue(true);

    await expect(
      pickDeviceServerUrl({
        advertised: ['http://100.76.35.114:3210'],
        configuredUrl: 'https://lobe.example.com',
        probe,
      }),
    ).resolves.toBe('http://100.76.35.114:3210');
  });

  it('falls back to the configured server when nothing advertised answers', async () => {
    probe.mockResolvedValue(false);

    await expect(
      pickDeviceServerUrl({
        advertised: ['http://10.0.0.9:3210'],
        configuredUrl: 'https://lobe.example.com',
        probe,
      }),
    ).resolves.toBe('https://lobe.example.com');
  });

  it('keeps the configured server when the deployment advertises nothing', async () => {
    await expect(
      pickDeviceServerUrl({ advertised: [], configuredUrl: 'https://lobe.example.com', probe }),
    ).resolves.toBe('https://lobe.example.com');
    expect(probe).not.toHaveBeenCalled();
  });

  it('probes an advertised address even when it equals the configured one', async () => {
    // An address that is in use still has to be verified rather than assumed —
    // the CLI shipped that mistake once (it skipped the address it was dialling
    // and then reported it unreachable).
    probe.mockResolvedValue(true);

    await expect(
      pickDeviceServerUrl({
        advertised: ['https://lobe.example.com'],
        configuredUrl: 'https://lobe.example.com',
        probe,
      }),
    ).resolves.toBe('https://lobe.example.com');
    expect(probe).toHaveBeenCalledWith('https://lobe.example.com');
  });

  it('takes the first reachable address when several are offered', async () => {
    probe.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await expect(
      pickDeviceServerUrl({
        advertised: ['http://10.0.0.9:3210', 'http://10.0.0.5:3210'],
        configuredUrl: 'https://lobe.example.com',
        probe,
      }),
    ).resolves.toBe('http://10.0.0.5:3210');
  });
});
