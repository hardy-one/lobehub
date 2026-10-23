'use client';

import { useTheme } from 'next-themes';
import { useEffect } from 'react';

import { resolveThemeColor } from './themeColor';

const ThemeColorMeta = () => {
  const { forcedTheme, resolvedTheme } = useTheme();

  useEffect(() => {
    const documentTheme = document.documentElement.getAttribute('data-theme');
    const color = resolveThemeColor(forcedTheme ?? resolvedTheme, documentTheme);
    const metas = document.head.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');

    if (metas.length === 0) {
      const meta = document.createElement('meta');
      meta.name = 'theme-color';
      meta.content = color;
      document.head.append(meta);
      return;
    }

    const [firstMeta, ...extraMetas] = metas;
    firstMeta.removeAttribute('media');
    firstMeta.content = color;
    for (const extraMeta of extraMetas) {
      extraMeta.remove();
    }
  }, [forcedTheme, resolvedTheme]);

  return null;
};

export default ThemeColorMeta;
