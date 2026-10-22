import { describe, expect, it } from 'vitest';

import { mobileHtmlTemplate } from './mobileHtmlTemplate.source';

describe('mobileHtmlTemplate', () => {
  it('uses the light safe area for Android gesture navigation in the PWA shell', () => {
    expect(mobileHtmlTemplate).toContain(
      '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />',
    );
    expect(mobileHtmlTemplate).toContain('color-scheme: light;');
    expect(mobileHtmlTemplate).toContain('background-color: #f8f8f8;');
  });
});
