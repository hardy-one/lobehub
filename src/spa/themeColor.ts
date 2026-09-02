export const LIGHT_THEME_COLOR = '#f8f8f8';
export const DARK_THEME_COLOR = '#000000';

export const resolveThemeColor = (theme?: string, documentTheme?: string | null) =>
  theme === 'dark' || (!theme && documentTheme === 'dark') ? DARK_THEME_COLOR : LIGHT_THEME_COLOR;
