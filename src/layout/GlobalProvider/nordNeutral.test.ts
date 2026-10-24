import { describe, expect, it } from 'vitest';

import { NORD_NEUTRAL_NAME, NORD_SWATCH_COLOR, nordNeutralScale } from './nordNeutral';

describe('nord neutral preset', () => {
  it('keeps the 13-step shape every scale slot needs', () => {
    for (const scale of Object.values(nordNeutralScale)) {
      expect(scale).toHaveLength(13);
    }
  });

  it('only changes the dark page background', () => {
    // Later steps are the default grey ladder, so containers, borders and text
    // stay identical to the unprefixed theme.
    expect(nordNeutralScale.dark[0]).toBe('#2e3440');
    expect(nordNeutralScale.dark.slice(1)).toEqual([
      '#0d0d0d',
      '#1a1a1a',
      '#202020',
      '#2d2d2d',
      '#444444',
      '#555555',
      '#666666',
      '#6f6f6f',
      '#777777',
      '#aaaaaa',
      '#dddddd',
      '#ffffff',
    ]);
  });

  it('leaves the light appearance untouched', () => {
    expect(nordNeutralScale.light[0]).toBe('#ffffff');
    expect(nordNeutralScale.light[1]).toBe('#f8f8f8');
  });

  it('is selectable under a name that is not a built-in preset', () => {
    expect(NORD_NEUTRAL_NAME).toBe('nord');
    expect(NORD_SWATCH_COLOR).toBe('#2e3440');
  });
});
