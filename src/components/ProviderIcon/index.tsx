'use client';

import { ProviderIcon as BaseProviderIcon } from '@lobehub/icons';
import { type CSSProperties } from 'react';
import { memo } from 'react';

import { getProviderIconKey } from '@/constants/providerIconMapping';

export interface ProviderIconProps {
  forceMono?: boolean;
  provider?: string;
  shape?: 'circle' | 'square';
  size?: number;
  style?: CSSProperties;
  type?: 'avatar' | 'mono' | 'color' | 'combine' | 'combine-color';
}

/**
 * ProviderIcon Wrapper
 * Automatically maps Coding Plan providers to their parent company icons
 */
export const ProviderIcon = memo<ProviderIconProps>(
  ({ provider, size = 24, type = 'avatar', shape = 'circle', forceMono, ...props }) => {
    // Map custom providers to existing icons
    const iconProvider = provider ? getProviderIconKey(provider) : undefined;

    return (
      <BaseProviderIcon
        forceMono={forceMono}
        provider={iconProvider}
        shape={shape}
        size={size}
        type={type}
        {...props}
      />
    );
  },
);

export default ProviderIcon;
