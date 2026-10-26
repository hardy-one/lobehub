import type { ColorScaleItem } from '@lobehub/ui/es/color/types';

/**
 * Dark neutrals tuned for astigmatism.
 *
 * The default dark theme pairs a near-black page with light text. That adapts
 * the eye to zero luminance, so glyphs halate and bleed into the background, and
 * the three surface steps sit at a 1.08:1 ratio that barely reads as depth. Each
 * preset below lifts the surfaces off black, keeps the step between adjacent
 * surfaces small, and lowers the body text contrast from ~15.5:1 to ~11:1, which
 * is still above WCAG AAA.
 *
 * Only the dark appearance is tuned. The light ladder, the primary colour, the
 * status palette and the syntax theme stay on their defaults.
 */
interface DarkPreset {
  /** `colorBgContainer`: content and code surfaces. */
  container: string;
  /** `colorBgElevated`: popovers, menus, modal surfaces. */
  elevated: string;
  label: string;
  /**
   * Full 13-step ladders for a preset that carries its own hue. When present it
   * replaces the derived scale entirely, because a tinted ladder cannot be
   * expressed by retinting three surface steps: the border and fill steps would
   * stay grey and cut against the tinted surfaces.
   */
  ladder?: { dark: ColorScaleItem['dark']; light: ColorScaleItem['light'] };
  /** `colorBgLayout`: sidebar, page background. */
  layout: string;
  name: string;
  /** Body text ladder, from strongest to dimmest. */
  text: [string, string, string, string];
}

const DARK_PRESETS: DarkPreset[] = [
  {
    container: '#23282f',
    elevated: '#2b313a',
    label: 'Blue Grey',
    layout: '#1b1f26',
    name: 'cool',
    text: ['#dedede', '#aaaaaa', '#8f8f8f', '#909090'],
  },
  {
    container: '#222325',
    elevated: '#2a2b2e',
    label: 'Neutral',
    layout: '#1a1b1d',
    name: 'neutral',
    text: ['#dedede', '#aaaaaa', '#8f8f8f', '#909090'],
  },
  {
    container: '#242424',
    elevated: '#2c2c2c',
    label: 'Warm Grey',
    layout: '#1c1c1c',
    name: 'warm',
    text: ['#dedede', '#aaaaaa', '#8f8f8f', '#909090'],
  },
  {
    container: '#073642',
    elevated: '#0d4753',
    label: 'Solarized',
    layout: '#002b36',
    // Solarized ships the low-contrast palette it was designed around: its body
    // text on base03 measures 4.75:1 and its dimmest step 2.79:1, so secondary
    // copy reads washed out. The ladder keeps base0's exact hue and saturation
    // (186deg, 8.3%) and spreads the lightness instead. Step 8 is still the
    // published base0; the text steps above it reach 10.5:1 in the same teal
    // family, matching the contrast rhythm of the other presets.
    ladder: {
      dark: [
        '#002b36',
        '#073642',
        '#0d4753',
        '#333c3d',
        '#414c4d',
        '#505c5e',
        '#606f71',
        '#708285',
        '#839496',
        '#96a4a6',
        '#a7b3b4',
        '#bac3c5',
        '#d3d9da',
      ] as ColorScaleItem['dark'],
      light: [
        '#fdf6e3',
        '#eee8d5',
        '#d9d1c0',
        '#d1d9db',
        '#bac5ca',
        '#a3b2b8',
        '#8fa2a8',
        '#7d939b',
        '#6d848d',
        '#5f747c',
        '#52646b',
        '#435156',
        '#313b3f',
      ] as ColorScaleItem['light'],
    },
    name: 'solarized',
    text: ['#d3d9da', '#bac3c5', '#a7b3b4', '#96a4a6'],
  },
];

/**
 * Steps the theme never derives on its own keep the default grey ladder, so an
 * untouched surface stays identical to the default theme.
 */
const DEFAULT_DARK_LADDER = [
  '#000000',
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
] as const;

const DEFAULT_DARK_ALPHA_LADDER = [
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
] as const;

const DEFAULT_LIGHT_LADDER = [
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
] as const;

const DEFAULT_LIGHT_ALPHA_LADDER = [
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
] as const;

const DEFAULT_LIGHT_TEXT: [string, string, string, string] = [
  '#1f1f1f',
  '#666666',
  '#8a8a8a',
  '#b0b0b0',
];

/** Alpha ladder derived from a ladder's strongest step, so fills share its tint. */
const buildAlphaLadder = (steps: readonly string[], alphas: readonly number[]) =>
  alphas.map((alpha, index) => {
    if (index === alphas.length - 1) return steps.at(-1);

    const [r, g, b] = [1, 3, 5].map((offset) =>
      Number.parseInt(steps.at(-1).slice(offset, offset + 2), 16),
    );
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }) as ColorScaleItem['darkA'];

const DARK_ALPHAS = [0.02, 0.06, 0.1, 0.16, 0.24, 0.28, 0.32, 0.38, 0.44, 0.5, 0.66, 0.84, 1];
const LIGHT_ALPHAS = [0.015, 0.03, 0.06, 0.12, 0.18, 0.24, 0.32, 0.38, 0.44, 0.5, 0.68, 0.84, 0.92];

const buildScale = ({ layout, container, elevated, ladder }: DarkPreset): ColorScaleItem => {
  if (ladder) {
    return {
      dark: ladder.dark,
      darkA: buildAlphaLadder(ladder.dark, DARK_ALPHAS),
      light: ladder.light,
      lightA: buildAlphaLadder(ladder.light, LIGHT_ALPHAS),
    };
  }

  // Only steps 0-2 drive the layout / container / elevated surfaces. Steps 3-12
  // keep the default ladder so borders and disabled fills do not shift.
  const dark = [...DEFAULT_DARK_LADDER] as ColorScaleItem['dark'];
  dark[0] = layout;
  dark[1] = container;
  dark[2] = elevated;

  return {
    dark,
    darkA: [...DEFAULT_DARK_ALPHA_LADDER] as ColorScaleItem['darkA'],
    light: [...DEFAULT_LIGHT_LADDER] as ColorScaleItem['light'],
    lightA: [...DEFAULT_LIGHT_ALPHA_LADDER] as ColorScaleItem['lightA'],
  };
};

export interface DarkNeutral {
  label: string;
  name: string;
  scale: ColorScaleItem;
  /** Swatch colour for the settings picker. */
  swatch: string;
  text: { dark: [string, string, string, string]; light: [string, string, string, string] };
}

export const DARK_NEUTRALS: DarkNeutral[] = DARK_PRESETS.map((preset) => ({
  label: preset.label,
  name: preset.name,
  scale: buildScale(preset),
  swatch: preset.layout,
  text: { dark: preset.text, light: DEFAULT_LIGHT_TEXT },
}));

export const isDarkNeutral = (value?: string | null) =>
  !!value && DARK_NEUTRALS.some((preset) => preset.name === value);

export const findDarkNeutral = (value?: string | null) =>
  DARK_NEUTRALS.find((preset) => preset.name === value);

type RegisterNeutral = (
  name: string,
  neutral: { scale: ColorScaleItem; text: DarkNeutral['text'] },
) => void;

export const registerDarkNeutrals = (register: RegisterNeutral) => {
  for (const preset of DARK_NEUTRALS) {
    register(preset.name, { scale: preset.scale, text: preset.text });
  }
};
