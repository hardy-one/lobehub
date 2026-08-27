import { describe, expect, it } from 'vitest';

import { resolveHtmlRenderEnabled } from './htmlRender';

describe('resolveHtmlRenderEnabled', () => {
  it('enables the preset when the lab switch is on for non-mobile clients', () => {
    expect(resolveHtmlRenderEnabled(true, false)).toBe(true);
  });

  it('disables the preset when the lab switch is off', () => {
    expect(resolveHtmlRenderEnabled(false, false)).toBe(false);
    expect(resolveHtmlRenderEnabled(undefined, false)).toBe(false);
  });

  it('disables the preset for mobile app clients even when the lab switch is on', () => {
    expect(resolveHtmlRenderEnabled(true, true)).toBe(false);
  });
});
