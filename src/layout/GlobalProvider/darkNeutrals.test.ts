import { describe, expect, it } from 'vitest';

import { DARK_NEUTRALS, findDarkNeutral, neutralsFor, suitsAppearance } from './darkNeutrals';

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
    expect(DARK_NEUTRALS.map(({ name }) => name)).toEqual([
      'solarized',
      'catppuccin-mocha',
      'catppuccin-macchiato',
      'catppuccin-frappe',
      'catppuccin-latte',
    ]);
  });

  it('drops a preset that does not suit the appearance in use', () => {
    // A dark preset left selected after switching to light keeps painting dark
    // surfaces, so it has to be treated as unusable there.
    expect(suitsAppearance('solarized', true)).toBe(true);
    expect(suitsAppearance('solarized', false)).toBe(false);
    expect(suitsAppearance('catppuccin-latte', false)).toBe(true);
    expect(suitsAppearance('catppuccin-latte', true)).toBe(false);
    // Names the theme does not own are left to the built-in selection.
    expect(suitsAppearance('slate', false)).toBe(true);
    expect(suitsAppearance(undefined, true)).toBe(true);
  });

  it('offers only the presets that suit the appearance in use', () => {
    // A preset tuned for one appearance reads wrong in the other, so the picker
    // must not mix them.
    expect(neutralsFor(true).every(({ appearance }) => appearance === 'dark')).toBe(true);
    expect(neutralsFor(false).map(({ name }) => name)).toEqual(['catppuccin-latte']);
    expect(neutralsFor(true).length + neutralsFor(false).length).toBe(DARK_NEUTRALS.length);
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
      // elevated one; the swatch previews the layout surface of the appearance
      // the preset belongs to.
      const [layout] = preset.appearance === 'dark' ? preset.scale.dark : preset.scale.light;

      expect(layout).toBe(preset.swatch);
      expect(layout).not.toBe('#000000');
    }
  });

  it('keeps the body text off the extreme end of the contrast range', () => {
    // Near-black surfaces push body text past 15:1, which is where halation
    // around glyphs becomes the reported readability problem.
    for (const preset of neutralsFor(true)) {
      const body = contrast(preset.text.dark[0], preset.scale.dark[1]);
      expect(body).toBeLessThan(14);
      expect(body).toBeGreaterThan(7);
    }
  });

  it('keeps the three readable dark text steps at or above the AA floor', () => {
    // The fourth step is decorative, so only the first three carry body copy.
    for (const preset of neutralsFor(true)) {
      for (const step of preset.text.dark.slice(0, 3)) {
        expect(contrast(step, preset.scale.dark[1])).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps the three readable light text steps at or above the AA floor', () => {
    // A light preset is read against its light container, not its dark one.
    for (const preset of neutralsFor(false)) {
      for (const step of preset.text.light.slice(0, 3)) {
        expect(contrast(step, preset.scale.light[1])).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('steps the text ladder down in order', () => {
    // Each step must read as weaker than the one before it. A ladder where two
    // neighbouring steps measure the same is a ladder with one step missing.
    const check = (steps: string[], surface: string) => {
      const values = steps.map((step) => contrast(step, surface));

      for (let index = 1; index < values.length; index++) {
        expect(values[index]).toBeLessThan(values[index - 1]);
      }

      // Neighbouring steps must differ enough to be told apart.
      for (let index = 1; index < values.length; index++) {
        expect(values[index - 1] - values[index]).toBeGreaterThan(0.3);
      }
    };

    for (const preset of neutralsFor(true)) {
      check(preset.text.dark, preset.scale.dark[1]);
    }

    for (const preset of neutralsFor(false)) {
      check(preset.text.light, preset.scale.light[1]);
    }
  });

  it('keeps a tinted preset on its own light ladder', () => {
    // A preset that carries a hue publishes both ladders. Retinting only the
    // dark surface steps would leave its light appearance on the grey default.
    expect(findDarkNeutral('solarized')?.scale.light[0]).toBe('#fdf6e3');
    expect(findDarkNeutral('catppuccin-latte')?.scale.light[0]).toBe('#eff1f5');
  });

  it('keeps the untinted presets on the default light ladder', () => {
    const untinted = DARK_NEUTRALS.filter(({ name }) => ['cool', 'neutral', 'warm'].includes(name));

    for (const preset of untinted) {
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
    expect(findDarkNeutral('solarized')?.swatch).toBe('#002b36');
  });
});
