'use client';

import { useTheme } from 'next-themes';
import { useEffect } from 'react';

import { resolveThemeColor } from './themeColor';

const ThemeColorMeta = () => {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const documentTheme = document.documentElement.getAttribute('data-theme');
    const color = resolveThemeColor(resolvedTheme, documentTheme);
    let meta = document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]');

    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.append(meta);
    }

    meta.content = color;
  }, [resolvedTheme]);

  return null;
};

export default ThemeColorMeta;
