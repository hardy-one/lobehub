import type { ColorScaleItem } from '@lobehub/ui/es/color/types';

/**
 * Nord's Polar Night and Snow Storm ramps in the 13-step shape the theme layer
 * expects: step 0 is the page background, 2 the elevated surface, 12 the
 * strongest text.
 *
 * Nord only publishes four Polar Night steps, so steps 1, 6-9 are interpolated
 * along the same blue hue between `#3b4252` and `#7b849f`. The rest keep Nord's
 * own values.
 *
 * This has to be registered as a full scale. `setLobeTheme` retints a plain hex
 * through the default grey ladder and clamps chroma to 0.05, which flattens
 * Nord's blue-grey into an almost neutral grey.
 */
export const nordNeutralScale: ColorScaleItem = {
  dark: [
    '#2e3440',
    '#2e3440',
    '#3b4252',
    '#3b4252',
    '#434c5e',
    '#4c566a',
    '#545e75',
    '#5e6880',
    '#6b7590',
    '#7b849f',
    '#a3abbd',
    '#d8dee9',
    '#eceff4',
  ],
  darkA: [
    'rgba(46, 52, 64, 0)',
    'rgba(216, 222, 233, 0.04)',
    'rgba(216, 222, 233, 0.08)',
    'rgba(216, 222, 233, 0.12)',
    'rgba(216, 222, 233, 0.18)',
    'rgba(216, 222, 233, 0.24)',
    'rgba(216, 222, 233, 0.3)',
    'rgba(216, 222, 233, 0.36)',
    'rgba(216, 222, 233, 0.42)',
    'rgba(216, 222, 233, 0.5)',
    'rgba(216, 222, 233, 0.66)',
    'rgba(216, 222, 233, 0.84)',
    '#eceff4',
  ],
  light: [
    '#ffffff',
    '#f4f6f9',
    '#e9ecf2',
    '#dbe0e9',
    '#c9d0dd',
    '#b6bfd0',
    '#a3abbd',
    '#8f99ad',
    '#7b849f',
    '#6b7590',
    '#4c566a',
    '#3b4252',
    '#2e3440',
  ],
  lightA: [
    'rgba(46, 52, 64, 0.02)',
    'rgba(46, 52, 64, 0.04)',
    'rgba(46, 52, 64, 0.07)',
    'rgba(46, 52, 64, 0.12)',
    'rgba(46, 52, 64, 0.18)',
    'rgba(46, 52, 64, 0.24)',
    'rgba(46, 52, 64, 0.3)',
    'rgba(46, 52, 64, 0.36)',
    'rgba(46, 52, 64, 0.42)',
    'rgba(46, 52, 64, 0.5)',
    'rgba(46, 52, 64, 0.68)',
    'rgba(46, 52, 64, 0.84)',
    'rgba(46, 52, 64, 0.92)',
  ],
};

/**
 * Nord's text ramp. Snow Storm supplies the two brightest steps; the dimmest
 * step is the darkest blue-grey that still reaches WCAG AA 4.5:1 on the
 * elevated surface, which placeholder text and disabled hints use.
 */
export const nordNeutralText: {
  dark: [string, string, string, string];
  light: [string, string, string, string];
} = {
  dark: ['#eceff4', '#d8dee9', '#a9b3c6', '#a8b2c5'],
  light: ['#2e3440', '#4c566a', '#5f6b82', '#63708b'],
};

export const NORD_NEUTRAL_NAME = 'nord';

export const isNordNeutral = (value?: string | null) => value === NORD_NEUTRAL_NAME;
