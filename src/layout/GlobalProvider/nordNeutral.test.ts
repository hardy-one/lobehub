import { describe, expect, it } from 'vitest';

import { NORD_NEUTRAL_NAME, nordNeutralScale, nordNeutralText } from './nordNeutral';

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a: string, b: string) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};

describe('nord neutral preset', () => {
  it('keeps the 13-step shape every scale slot needs', () => {
    for (const scale of Object.values(nordNeutralScale)) {
      expect(scale).toHaveLength(13);
    }
  });

  it('uses Polar Night for the dark surfaces', () => {
    expect(nordNeutralScale.dark[0]).toBe('#2e3440');
    expect(nordNeutralScale.dark[2]).toBe('#3b4252');
    expect(nordNeutralScale.dark[12]).toBe('#eceff4');
  });

  it('registers under a name that is not a built-in preset', () => {
    expect(NORD_NEUTRAL_NAME).toBe('nord');
  });

  it('keeps every dark text step readable on the elevated surface', () => {
    // Placeholder and disabled hints use the dimmest step, so it sets the floor.
    for (const step of nordNeutralText.dark) {
      expect(contrast(step, nordNeutralScale.dark[2])).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps every light text step readable on the page background', () => {
    for (const step of nordNeutralText.light) {
      expect(contrast(step, nordNeutralScale.light[1])).toBeGreaterThanOrEqual(4.5);
    }
  });
});
