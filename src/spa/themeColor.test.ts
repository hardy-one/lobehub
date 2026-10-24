import { describe, expect, it } from 'vitest';

import { DARK_THEME_COLOR, resolveThemeColor } from './themeColor';

describe('resolveThemeColor', () => {
  it('uses the dark color for a dark theme', () => {
    expect(resolveThemeColor('dark')).toBe(DARK_THEME_COLOR);
  });

  it('uses the light color for a light theme', () => {
    expect(resolveThemeColor('light')).toBe('#f8f8f8');
  });

  it('falls back to the document theme before the provider resolves', () => {
    expect(resolveThemeColor(undefined, 'dark')).toBe(DARK_THEME_COLOR);
    expect(resolveThemeColor(undefined, 'light')).toBe('#f8f8f8');
  });

  it('does not paint the browser chrome pure black', () => {
    expect(DARK_THEME_COLOR).not.toBe('#000000');
  });
});
