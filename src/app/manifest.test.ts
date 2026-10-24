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

  it('declares the spec dark color scheme so a future Chrome release can follow the OS theme', async () => {
    const result = await manifest();

    // WebAPK freezes the manifest colors at install time and Chrome has not shipped
    // `color_scheme_dark` yet (crbug.com/383165202), so the member is inert today.
    // It is still the only spec-compliant way to describe the dark variant.
    expect((result as Record<string, unknown>).color_scheme_dark).toEqual({
      background_color: '#141517',
      theme_color: '#141517',
    });
  });

  it('keeps the installed shell off pure black', async () => {
    const result = await manifest();

    expect(result.background_color).toBe('#141517');
    expect(result.theme_color).toBe('#141517');
  });
});
