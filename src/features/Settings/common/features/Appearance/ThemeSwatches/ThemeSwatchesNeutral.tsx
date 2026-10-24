import { type NeutralColors } from '@lobehub/ui';
import { ColorSwatches, findCustomThemeName, neutralColors } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  isNordNeutral,
  NORD_NEUTRAL_NAME,
  NORD_SWATCH_COLOR,
} from '@/layout/GlobalProvider/nordNeutral';

interface IProps {
  onChange?: (v: NeutralColors) => void;
  value?: NeutralColors;
}

const ThemeSwatchesNeutral = memo<IProps>(({ value, onChange }) => {
  const { t } = useTranslation('color');

  const handleSelect = (v: any) => {
    // Nord is registered at runtime, so it is not in the built-in name table.
    const name = v === NORD_SWATCH_COLOR ? NORD_NEUTRAL_NAME : findCustomThemeName('neutral', v);

    onChange?.((name || '') as NeutralColors);
  };

  return (
    <ColorSwatches
      colors={[
        {
          color: 'rgba(0, 0, 0, 0)',
          title: t('default'),
        },
        {
          color: neutralColors.mauve,
          title: t('mauve'),
        },
        {
          color: neutralColors.olive,
          title: t('olive'),
        },
        {
          color: neutralColors.sage,
          title: t('sage'),
        },
        {
          color: neutralColors.sand,
          title: t('sand'),
        },
        {
          color: neutralColors.slate,
          title: t('slate'),
        },
        {
          color: NORD_SWATCH_COLOR,
          title: 'Nord',
        },
      ]}
      value={
        value
          ? isNordNeutral(value)
            ? NORD_SWATCH_COLOR
            : neutralColors[value as keyof typeof neutralColors]
          : undefined
      }
      onChange={handleSelect}
    />
  );
});

export default ThemeSwatchesNeutral;
