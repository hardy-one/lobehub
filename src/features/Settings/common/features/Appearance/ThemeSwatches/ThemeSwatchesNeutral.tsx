import { type NeutralColors } from '@lobehub/ui';
import { ColorSwatches, findCustomThemeName, neutralColors } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  isNordNeutral,
  NORD_NEUTRAL_NAME,
  NORD_SWATCH_COLOR,
} from '@/layout/GlobalProvider/nordNeutral';
import { findSoftDarkNeutral, SOFT_DARK_NEUTRALS } from '@/layout/GlobalProvider/softDarkNeutrals';

interface IProps {
  onChange?: (v: NeutralColors) => void;
  value?: NeutralColors;
}

const ThemeSwatchesNeutral = memo<IProps>(({ value, onChange }) => {
  const { t } = useTranslation('color');

  // Every preset below is registered at runtime, so none of them is in the
  // built-in neutral name table. Match the swatch colour back to its name first
  // and only then fall back to the table.
  const handleSelect = (v: any) => {
    const softDark = SOFT_DARK_NEUTRALS.find((preset) => preset.swatch === v);

    const name = softDark
      ? softDark.name
      : v === NORD_SWATCH_COLOR
        ? NORD_NEUTRAL_NAME
        : findCustomThemeName('neutral', v);

    onChange?.((name || '') as NeutralColors);
  };

  const current =
    findSoftDarkNeutral(value)?.swatch ?? (isNordNeutral(value) ? NORD_SWATCH_COLOR : undefined);

  return (
    <ColorSwatches
      value={current ?? neutralColors[value as keyof typeof neutralColors]}
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
        ...SOFT_DARK_NEUTRALS.map((preset) => ({
          color: preset.swatch,
          title: t(preset.name as 'soft-cool'),
        })),
      ]}
      onChange={handleSelect}
    />
  );
});

export default ThemeSwatchesNeutral;
