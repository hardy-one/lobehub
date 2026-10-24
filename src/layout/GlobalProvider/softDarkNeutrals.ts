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
interface SoftDarkPreset {
  /** `colorBgContainer`: content and code surfaces. */
  container: string;
  /** `colorBgElevated`: popovers, menus, modal surfaces. */
  elevated: string;
  label: string;
  /** `colorBgLayout`: sidebar, page background. */
  layout: string;
  name: string;
  /** Body text ladder, from strongest to dimmest. */
  text: [string, string, string, string];
}

const SOFT_DARK_PRESETS: SoftDarkPreset[] = [
  {
    container: '#23282f',
    elevated: '#2b313a',
    label: 'Soft Blue Grey',
    layout: '#1b1f26',
    name: 'soft-cool',
    text: ['#dedede', '#aaaaaa', '#8f8f8f', '#909090'],
  },
  {
    container: '#222325',
    elevated: '#2a2b2e',
    label: 'Soft Neutral',
    layout: '#1a1b1d',
    name: 'soft-neutral',
    text: ['#dedede', '#aaaaaa', '#8f8f8f', '#909090'],
  },
  {
    container: '#242424',
    elevated: '#2c2c2c',
    label: 'Soft Warm Grey',
    layout: '#1c1c1c',
    name: 'soft-warm',
    text: ['#dedede', '#aaaaaa', '#8f8f8f', '#909090'],
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

const buildScale = ({ layout, container, elevated }: SoftDarkPreset): ColorScaleItem => {
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

export interface SoftDarkNeutral {
  label: string;
  name: string;
  scale: ColorScaleItem;
  /** Swatch colour for the settings picker. */
  swatch: string;
  text: { dark: [string, string, string, string]; light: [string, string, string, string] };
}

export const SOFT_DARK_NEUTRALS: SoftDarkNeutral[] = SOFT_DARK_PRESETS.map((preset) => ({
  label: preset.label,
  name: preset.name,
  scale: buildScale(preset),
  swatch: preset.layout,
  text: { dark: preset.text, light: DEFAULT_LIGHT_TEXT },
}));

export const isSoftDarkNeutral = (value?: string | null) =>
  !!value && SOFT_DARK_NEUTRALS.some((preset) => preset.name === value);

export const findSoftDarkNeutral = (value?: string | null) =>
  SOFT_DARK_NEUTRALS.find((preset) => preset.name === value);

type RegisterNeutral = (
  name: string,
  neutral: { scale: ColorScaleItem; text: SoftDarkNeutral['text'] },
) => void;

export const registerSoftDarkNeutrals = (register: RegisterNeutral) => {
  for (const preset of SOFT_DARK_NEUTRALS) {
    register(preset.name, { scale: preset.scale, text: preset.text });
  }
};
