// @vitest-environment node
import { LOBE_USER_AGENT } from '@lobechat/const';
import { describe, expect, it, vi } from 'vitest';

import { LobeReplicateAI } from './index';

const { mockSsrfSafeFetch } = vi.hoisted(() => ({ mockSsrfSafeFetch: vi.fn() }));
vi.mock('@lobechat/ssrf-safe-fetch', () => ({ ssrfSafeFetch: mockSsrfSafeFetch }));

describe('LobeReplicateAI client', () => {
  it('identifies itself with the LobeHub User-Agent', () => {
    // `headers` is not a Replicate option and was silently dropped, so the UA
    // has to ride the option the SDK actually sends.
    const runtime = new LobeReplicateAI({ apiKey: 'test-key' });

    expect(runtime['client'].userAgent).toBe(LOBE_USER_AGENT);
  });
});

describe('LobeReplicateAI createImage', () => {
  it('releases the unread body when a local reference image fails to download', async () => {
    const cancel = vi.fn();
    mockSsrfSafeFetch.mockResolvedValue(
      new Response(new ReadableStream({ cancel, pull: () => new Promise(() => {}) }), {
        status: 502,
      }),
    );
    const runtime = new LobeReplicateAI({ apiKey: 'test-key' });

    await expect(
      runtime.createImage({
        model: 'black-forest-labs/flux-kontext-pro',
        params: { imageUrl: 'http://127.0.0.1:3010/f/image.png', prompt: 'a cat' },
      } as any),
    ).rejects.toThrow();

    expect(mockSsrfSafeFetch).toHaveBeenCalledWith('http://127.0.0.1:3010/f/image.png');
    expect(cancel).toHaveBeenCalled();
  });
});
