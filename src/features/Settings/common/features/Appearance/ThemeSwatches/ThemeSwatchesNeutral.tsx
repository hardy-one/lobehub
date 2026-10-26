import { type NeutralColors } from '@lobehub/ui';
import { ColorSwatches, findCustomThemeName, neutralColors, useThemeMode } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DARK_NEUTRALS, findDarkNeutral, neutralsFor } from '@/layout/GlobalProvider/darkNeutrals';

interface IProps {
  onChange?: (v: NeutralColors) => void;
  value?: NeutralColors;
}

const ThemeSwatchesNeutral = memo<IProps>(({ value, onChange }) => {
  const { t } = useTranslation('color');
  const { isDarkMode } = useThemeMode();

  // A preset tuned for one appearance looks wrong in the other, so the picker
  // only offers the ones that suit the appearance currently in use.
  const presets = neutralsFor(isDarkMode);

  // The presets below are registered at runtime, so none of them is in the
  // built-in neutral name table. Match the swatch colour back to its name first
  // and only then fall back to the table.
  const handleSelect = (v: any) => {
    const preset = DARK_NEUTRALS.find((item) => item.swatch === v);
    const name = preset ? preset.name : findCustomThemeName('neutral', v);

    onChange?.((name || '') as NeutralColors);
  };

  return (
    <ColorSwatches
      value={findDarkNeutral(value)?.swatch ?? neutralColors[value]}
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
        ...presets.map((preset) => ({
          color: preset.swatch,
          title: t(preset.name),
        })),
      ]}
      onChange={handleSelect}
    />
  );
});

export default ThemeSwatchesNeutral;
