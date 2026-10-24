import { describe, expect, it } from 'vitest';

import { DARK_NEUTRAL_COLOR } from './darkNeutral';

describe('DARK_NEUTRAL_COLOR', () => {
  it('is a hex value the theme layer treats as a custom neutral', () => {
    expect(DARK_NEUTRAL_COLOR).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('keeps the dark layout surface off pure black', () => {
    // Pure black maximises halation around light text, which is the reported
    // readability problem for astigmatic users.
    expect(DARK_NEUTRAL_COLOR).not.toBe('#000000');
  });
});
