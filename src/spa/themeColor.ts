import { DARK_NEUTRAL_COLOR } from '@/layout/GlobalProvider/darkNeutral';

export const LIGHT_THEME_COLOR = '#f8f8f8';
// Mirrors the dark `colorBgLayout`, so browser chrome never shows pure black next
// to the softened app surface.
export const DARK_THEME_COLOR = DARK_NEUTRAL_COLOR;

export const resolveThemeColor = (theme?: string, documentTheme?: string | null) =>
  theme === 'dark' || (!theme && documentTheme === 'dark') ? DARK_THEME_COLOR : LIGHT_THEME_COLOR;
