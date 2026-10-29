/**
 * Page surface colours that have to be known outside the theme provider: the HTML
 * shells paint them before React mounts, and the browser chrome and manifest
 * repeat them. They mirror the `layout` step of the default light and dark
 * colour schemes.
 */
export const LIGHT_NEUTRAL_PAGE = '#f8f8f8';

/** Matches the `neutral` dark scheme, which is the default dark page surface. */
export const DARK_NEUTRAL_PAGE = '#1a1b1d';
