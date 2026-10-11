import { afterEach, describe, expect, it, vi } from 'vitest';

import { chooseAgentGatewayUrl } from './chooseAgentGatewayUrl';

describe('chooseAgentGatewayUrl', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('selects a private candidate without an unrelated HTTP probe', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('no HTTP endpoint'));
    vi.stubGlobal('fetch', fetch);
    await expect(
      chooseAgentGatewayUrl({
        advertised: ['wss://private.test', 'https://public.test'],
        configuredUrl: 'https://public.test',
      }),
    ).resolves.toEqual({ source: 'advertised', url: 'wss://private.test' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    'http://private.test',
    'ws://private.test',
    'ftp://private.test',
    'bad-url',
    'https://user:password@private.test',
  ])('ignores unsafe or invalid candidate %s', async (url) => {
    await expect(
      chooseAgentGatewayUrl({ advertised: [url], configuredUrl: 'https://public.test' }),
    ).resolves.toEqual({ source: 'configured', url: 'https://public.test' });
  });

  it('keeps the configured endpoint when nothing is offered', async () => {
    await expect(
      chooseAgentGatewayUrl({ advertised: [], configuredUrl: undefined }),
    ).resolves.toEqual({ source: 'configured', url: undefined });
  });
});
