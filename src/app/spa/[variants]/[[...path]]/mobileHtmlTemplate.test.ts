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
      '<meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)" />',
    );
    expect(mobileHtmlTemplate).toContain('color-scheme: light;');
    expect(mobileHtmlTemplate).toContain('background-color: #f8f8f8;');
    expect(mobileHtmlTemplate).toContain(
      "var themeColor = resolvedTheme === 'dark' ? '#000000' : '#f8f8f8';",
    );
  });
});
