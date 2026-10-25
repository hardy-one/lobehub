import { describe, expect, it } from 'vitest';

import { DARK_NEUTRALS, findDarkNeutral, isDarkNeutral } from './darkNeutrals';

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

describe('dark neutrals', () => {
  it('offers the tuned presets', () => {
    expect(DARK_NEUTRALS.map(({ name }) => name)).toEqual(['cool', 'neutral', 'warm', 'solarized']);
  });

  it('keeps every scale slot at 13 steps', () => {
    for (const preset of DARK_NEUTRALS) {
      for (const scale of Object.values(preset.scale)) {
        expect(scale).toHaveLength(13);
      }
    }
  });

  it('selects the surfaces the theme reads', () => {
    for (const preset of DARK_NEUTRALS) {
      // scale[0] is the layout surface, scale[1] the container, scale[2] the
      // elevated one; the swatch previews the layout surface.
      expect(preset.scale.dark[0]).toBe(preset.swatch);
      expect(preset.scale.dark[0]).not.toBe('#000000');
    }
  });

  it('keeps the body text off the extreme end of the contrast range', () => {
    // Near-black surfaces push body text past 15:1, which is where halation
    // around glyphs becomes the reported readability problem.
    for (const preset of DARK_NEUTRALS) {
      const body = contrast(preset.text.dark[0], preset.scale.dark[1]);
      expect(body).toBeLessThan(14);
      expect(body).toBeGreaterThan(7);
    }
  });

  it('keeps every dark text step at or above the AA floor', () => {
    for (const preset of DARK_NEUTRALS) {
      for (const step of preset.text.dark) {
        expect(contrast(step, preset.scale.dark[1])).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps a tinted preset on its own light ladder', () => {
    // A preset that carries a hue publishes both ladders. Retinting only the
    // dark surface steps would leave its light appearance on the grey default.
    expect(findDarkNeutral('solarized')?.scale.light[0]).toBe('#fdf6e3');
    expect(findDarkNeutral('solarized')?.scale.light[1]).toBe('#eee8d5');
  });

  it('keeps the untinted presets on the default light ladder', () => {
    for (const preset of DARK_NEUTRALS.filter(({ name }) => name !== 'solarized')) {
      expect(preset.scale.light[0]).toBe('#ffffff');
      expect(preset.scale.light[1]).toBe('#f8f8f8');
    }
  });

  it('separates the three dark surfaces enough to read as depth', () => {
    // The complaint behind these presets was a 1.08:1 step between surfaces,
    // where a card is indistinguishable from the page. The tuned presets sit a
    // little above that; this guards against a preset flattening back into one.
    for (const preset of DARK_NEUTRALS) {
      const [layout, container, elevated] = preset.scale.dark;
      expect(contrast(layout, container)).toBeGreaterThan(1.08);
      expect(contrast(container, elevated)).toBeGreaterThan(1.08);
    }
  });

  it('resolves a stored name back to its swatch', () => {
    expect(isDarkNeutral('cool')).toBe(true);
    expect(isDarkNeutral('mauve')).toBe(false);
    expect(findDarkNeutral('warm')?.swatch).toBe('#1c1c1c');
  });
});
