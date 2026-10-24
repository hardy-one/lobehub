import { type NeutralColors } from '@lobehub/ui';
import { ColorSwatches, findCustomThemeName, neutralColors } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  isNordNeutral,
  NORD_NEUTRAL_NAME,
  nordNeutralScale,
} from '@/layout/GlobalProvider/nordNeutral';

interface IProps {
  onChange?: (v: NeutralColors) => void;
  value?: NeutralColors;
}

const ThemeSwatchesNeutral = memo<IProps>(({ value, onChange }) => {
  const { t } = useTranslation('color');

  const handleSelect = (v: any) => {
    // The registered Nord preset is not part of the built-in name table, so it is
    // matched before falling back to `findCustomThemeName`.
    const name =
      v === nordNeutralScale.dark[9] ? NORD_NEUTRAL_NAME : findCustomThemeName('neutral', v);

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
          color: nordNeutralScale.dark[9],
          title: 'Nord',
        },
      ]}
      value={
        value
          ? isNordNeutral(value)
            ? nordNeutralScale.dark[9]
            : neutralColors[value as keyof typeof neutralColors]
          : undefined
      }
      onChange={handleSelect}
    />
  );
});

export default ThemeSwatchesNeutral;
