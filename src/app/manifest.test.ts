import { describe, expect, it } from 'vitest';

import manifest from './manifest';

describe('manifest', () => {
  it('lists only the any-purpose icons while the maskable assets are not safe-zone ready', async () => {
    const result = await manifest();

    // `icon-*.maskable.png` paints ~74% of its canvas transparent, so Android's
    // adaptive mask shows the launcher background through the icon. The manifest
    // must not advertise them until those assets fill the safe zone.
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
