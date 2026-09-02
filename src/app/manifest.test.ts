import { describe, expect, it } from 'vitest';

import manifest from './manifest';

describe('manifest', () => {
  it('uses the opaque any-purpose icons for PWA installation', async () => {
    const result = await manifest();

    expect(result.icons).toHaveLength(2);
    expect(
      result.icons?.map(({ purpose, sizes, src, type }) => ({ purpose, sizes, src, type })),
    ).toEqual([
      {
        sizes: '192x192',
        src: '/app-icons/icon-192x192.png?v=1',
        type: 'image/png',
        purpose: 'any',
      },
      {
        sizes: '512x512',
        src: '/app-icons/icon-512x512.png?v=1',
        type: 'image/png',
        purpose: 'any',
      },
    ]);
  });
});
