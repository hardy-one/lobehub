'use client';

import type { ModelIcon } from '@lobehub/icons';
import { Center } from '@lobehub/ui';
import type { ComponentProps } from 'react';

import { useIsDark } from '@/hooks/useIsDark';

import type { PlantModel } from './plantModel';

interface PlantArtwork {
  dark: { background: string; color: string };
  light: { background: string; color: string };
  paths: { d: string; fillOpacity?: number; opacity?: number }[];
  strokeWidth: number;
}

// lobe-design-ignore-file LOBE-RAW-COLOR: Fixed model identity colors from the approved icon artwork, independent of the app's primary color.
const artwork: Record<PlantModel, PlantArtwork> = {
  maple: {
    dark: { background: '#bd604c20', color: '#f2a184' },
    light: { background: '#f8e9e1', color: '#b75033' },
    paths: [
      { d: 'M24 41V28' },
      {
        d: 'M24 7l4 9 5-3-1 10 9-3-3 7 4 2-14 6h-8L6 29l4-2-3-7 9 3-1-10 5 3z',
        fillOpacity: 0.12,
      },
      { d: 'M24 16v17M15 26l9 7 9-7' },
    ],
    strokeWidth: 1.9,
  },
  sage: {
    dark: { background: '#8caa7c20', color: '#b0c5a3' },
    light: { background: '#edf1e7', color: '#687e54' },
    paths: [
      { d: 'M23 41c0-10 2-19 5-28' },
      {
        d: 'M28 18c-3-6 0-10 6-12 2 6 0 11-6 12zM26 25c-8 0-12-4-12-10 8-1 12 3 12 10zM25 32c1-8 6-11 13-10-1 7-5 11-13 10zM23 37c-8 1-13-2-14-9 8-2 13 1 14 9z',
        fillOpacity: 0.15,
      },
    ],
    strokeWidth: 1.9,
  },
  fern: {
    dark: { background: '#4ba08020', color: '#77c7a4' },
    light: { background: '#e5f2ec', color: '#2e8a67' },
    paths: [
      { d: 'M18 42c6-9 10-20 12-35' },
      {
        d: 'M29 14c-5-1-7-4-6-7 4 0 6 3 6 7zM29 16c1-5 4-7 8-6-1 4-4 6-8 6zM27 22c-6 0-10-4-10-8 6 0 10 3 10 8zM27 24c2-6 6-8 11-6-2 5-6 7-11 6zM24 30c-7 0-11-3-12-8 6-1 11 2 12 8zM23 32c4-6 8-7 13-4-3 4-7 6-13 4zM20 37c-6 0-10-2-12-7 6-1 10 1 12 7z',
        fillOpacity: 0.16,
      },
    ],
    strokeWidth: 1.8,
  },
  moss: {
    dark: { background: '#9aab5620', color: '#c1ce85' },
    light: { background: '#f0f2df', color: '#7a8939' },
    paths: [
      { d: 'M7 37c4-2 9-2 13-1 7-2 14-2 21 0' },
      { d: 'M13 34V24m0 5-5-5m5 2 5-5M24 34V17m0 10-6-5m6 0 6-6M35 33V23m0 6-5-4m5 0 5-5' },
      { d: 'M21 16l3-4 3 4M6 23l2-3 3 1M16 20l3-3 2 3M28 16l3-3 2 3M38 20l3-3 2 3' },
      { d: 'M10 40h4m7-1h5m7 1h4', opacity: 0.45 },
    ],
    strokeWidth: 1.9,
  },
};

interface PlantModelIconProps extends Omit<ComponentProps<typeof ModelIcon>, 'model'> {
  plant: PlantModel;
}

export const PlantModelIcon = ({
  plant,
  size = 24,
  type = 'avatar',
  shape = 'circle',
  className,
  style,
}: PlantModelIconProps) => {
  const isDark = useIsDark();
  const icon = artwork[plant];
  const palette = isDark ? icon.dark : icon.light;
  const isAvatar = type === 'avatar';
  const isMono = type === 'mono' || type === 'combine';
  const glyphSize = isAvatar ? size * 0.6 : size;
  const glyph = (
    <svg
      aria-hidden
      fill={'none'}
      focusable={'false'}
      height={glyphSize}
      stroke={'currentColor'}
      strokeLinecap={'round'}
      strokeLinejoin={'round'}
      strokeWidth={icon.strokeWidth}
      viewBox={'0 0 48 48'}
      width={glyphSize}
      xmlns={'http://www.w3.org/2000/svg'}
    >
      {icon.paths.map((path) => (
        <path
          d={path.d}
          fill={path.fillOpacity ? 'currentColor' : 'none'}
          fillOpacity={path.fillOpacity}
          key={path.d}
          opacity={path.opacity}
        />
      ))}
    </svg>
  );

  return (
    <Center
      aria-hidden
      className={className}
      flex={'none'}
      height={size}
      width={size}
      style={{
        background: isAvatar ? palette.background : undefined,
        borderRadius: isAvatar ? (shape === 'circle' ? '50%' : Math.floor(size * 0.1)) : undefined,
        color: isMono ? 'currentColor' : palette.color,
        ...style,
      }}
    >
      {glyph}
    </Center>
  );
};
