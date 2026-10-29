import { describe, expect, it } from 'vitest';

import { DARK_NEUTRAL_PAGE } from '@/const/themeSurface';

import { DARK_THEME_COLOR, resolveThemeColor } from './themeColor';

describe('resolveThemeColor', () => {
  it('uses the dark color for a dark theme', () => {
    expect(resolveThemeColor('dark')).toBe('#1a1b1d');
  });

  it('uses the light color for a light theme', () => {
    expect(resolveThemeColor('light')).toBe('#f8f8f8');
  });

  it('falls back to the document theme before the provider resolves', () => {
    expect(resolveThemeColor(undefined, 'dark')).toBe('#1a1b1d');
    expect(resolveThemeColor(undefined, 'light')).toBe('#f8f8f8');
  });

  it('paints the browser chrome with the page surface, not pure black', () => {
    // A black system bar above a softened page reads as a seam, and pure black is
    // also what makes light text halate for astigmatic readers.
    expect(DARK_THEME_COLOR).toBe(DARK_NEUTRAL_PAGE);
    expect(DARK_THEME_COLOR).not.toBe('#000000');
  });
});
