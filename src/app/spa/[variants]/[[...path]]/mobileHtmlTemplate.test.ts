import { describe, expect, it } from 'vitest';

import { mobileHtmlTemplate } from './mobileHtmlTemplate.source';

describe('mobileHtmlTemplate', () => {
  it('uses scheme-aware theme-color and safe area in the PWA shell', () => {
    expect(mobileHtmlTemplate).toContain(
      '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />',
    );
    expect(mobileHtmlTemplate).toContain(
      '<meta name="theme-color" content="#f8f8f8" media="(prefers-color-scheme: light)" />',
    );
    expect(mobileHtmlTemplate).toContain(
      '<meta name="theme-color" content="#141517" media="(prefers-color-scheme: dark)" />',
    );
    expect(mobileHtmlTemplate).toContain('color-scheme: light;');
    expect(mobileHtmlTemplate).toContain('background-color: #f8f8f8;');
    expect(mobileHtmlTemplate).toContain(
      "var themeColor = resolvedTheme === 'dark' ? '#141517' : '#f8f8f8';",
    );
  });

  it('never paints the dark shell pure black', () => {
    // Pure black behind light glyphs maximises halation, which is the reported
    // readability problem for astigmatic users.
    expect(mobileHtmlTemplate).not.toContain('#000');
  });
});
