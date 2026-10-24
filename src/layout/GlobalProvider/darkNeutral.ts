/**
 * Neutral seed for the dark theme's surface ladder.
 *
 * `@lobehub/ui` builds a full dark palette from this hex, keeping the grey
 * ladder's lightness and retinting it to this value's hue. The value is the
 * layout surface, so the generated ladder lands at roughly:
 *
 * - layout `#141517`
 * - container `#1c1d1f`
 * - elevated `#26272b`
 *
 * Pure black was the previous layout surface. It leaves the eye adapted to zero
 * luminance, so light glyphs halate and bleed into the background, and the three
 * surface steps sat at a 1.08:1 ratio that barely reads as depth. The same value
 * is duplicated in the static HTML shells, `src/spa/themeColor.ts` and the
 * manifest because those paint before this theme is applied.
 */
export const DARK_NEUTRAL_COLOR = '#141517';
