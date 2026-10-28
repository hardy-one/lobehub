import { DARK_NEUTRAL_PAGE, LIGHT_NEUTRAL_PAGE } from '@/const/themeSurface';

// The browser chrome follows the page surface, so it has to be the same value the
// app paints at that spot. Pure black would put a black bar above a softened page.
export const LIGHT_THEME_COLOR = LIGHT_NEUTRAL_PAGE;
export const DARK_THEME_COLOR = DARK_NEUTRAL_PAGE;

export const resolveThemeColor = (theme?: string, documentTheme?: string | null) =>
  theme === 'dark' || (!theme && documentTheme === 'dark') ? DARK_THEME_COLOR : LIGHT_THEME_COLOR;
