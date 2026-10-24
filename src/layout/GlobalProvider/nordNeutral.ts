import type { ColorScaleItem } from '@lobehub/ui/es/color/types';

/**
 * Nord preset for the neutral setting: it only swaps the dark page background to
 * Nord's Polar Night `#2e3440` and leaves every other surface and text tone on
 * the current default ladder.
 *
 * The scale has to be registered rather than passed as a plain hex. `setLobeTheme`
 * retints an arbitrary hex through the grey ladder and clamps chroma to 0.05,
 * which would flatten `#2e3440` into a near-neutral grey. Registration also keeps
 * the choice inside the neutral setting, so the primary colour, the status palette
 * and the syntax theme are untouched.
 */
export const NORD_NEUTRAL_NAME = 'nord';

export const isNordNeutral = (value?: string | null) => value === NORD_NEUTRAL_NAME;

export const nordNeutralScale: ColorScaleItem = {
  dark: [
    // step 0 is `colorBgLayout`; the rest stay on the default grey ladder
    '#2e3440',
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
  ],
  darkA: [
    'rgba(255, 255, 255, 0.02)',
    'rgba(255, 255, 255, 0.06)',
    'rgba(255, 255, 255, 0.1)',
    'rgba(255, 255, 255, 0.16)',
    'rgba(255, 255, 255, 0.24)',
    'rgba(255, 255, 255, 0.28)',
    'rgba(255, 255, 255, 0.32)',
    'rgba(255, 255, 255, 0.38)',
    'rgba(255, 255, 255, 0.44)',
    'rgba(255, 255, 255, 0.5)',
    'rgba(255, 255, 255, 0.66)',
    'rgba(255, 255, 255, 0.84)',
    '#ffffff',
  ],
  light: [
    '#ffffff',
    '#f8f8f8',
    '#eeeeee',
    '#e3e3e3',
    '#dddddd',
    '#cccccc',
    '#bbbbbb',
    '#aaaaaa',
    '#999999',
    '#888888',
    '#666666',
    '#333333',
    '#080808',
  ],
  lightA: [
    'rgba(0, 0, 0, 0.015)',
    'rgba(0, 0, 0, 0.03)',
    'rgba(0, 0, 0, 0.06)',
    'rgba(0, 0, 0, 0.12)',
    'rgba(0, 0, 0, 0.18)',
    'rgba(0, 0, 0, 0.24)',
    'rgba(0, 0, 0, 0.32)',
    'rgba(0, 0, 0, 0.38)',
    'rgba(0, 0, 0, 0.44)',
    'rgba(0, 0, 0, 0.5)',
    'rgba(0, 0, 0, 0.68)',
    'rgba(0, 0, 0, 0.84)',
    'rgba(0, 0, 0, 0.92)',
  ],
};

/**
 * Pinned to the default text ladder. Without it the theme derives the text steps
 * from this scale, and step 10 would read as `#aaaaaa` instead of the current
 * `#b4b4b4`.
 */
export const nordNeutralText: {
  dark: [string, string, string, string];
  light: [string, string, string, string];
} = {
  dark: ['#e6e6e6', '#b4b4b4', '#8f8f8f', '#6b6b6b'],
  light: ['#1f1f1f', '#666666', '#8a8a8a', '#b0b0b0'],
};

/** Swatch shown in the neutral picker; the same blue-grey as the dark page. */
export const NORD_SWATCH_COLOR = nordNeutralScale.dark[0];
