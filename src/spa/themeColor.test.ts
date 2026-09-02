import { describe, expect, it } from 'vitest';

import { resolveThemeColor } from './themeColor';

describe('resolveThemeColor', () => {
  it('uses the dark color for a dark theme', () => {
    expect(resolveThemeColor('dark')).toBe('#000000');
  });

  it('uses the light color for a light theme', () => {
    expect(resolveThemeColor('light')).toBe('#f8f8f8');
  });

  it('falls back to the document theme before the provider resolves', () => {
    expect(resolveThemeColor(undefined, 'dark')).toBe('#000000');
    expect(resolveThemeColor(undefined, 'light')).toBe('#f8f8f8');
  });
});
