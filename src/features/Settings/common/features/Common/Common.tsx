'use client';

import { Flexbox, Icon, ImageSelect, Select, Tabs } from '@lobehub/ui';
import { Form, type FormGroupItem, useForm } from '@lobehub/ui/form';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import isEqual from 'fast-deep-equal';
import { Ban, Gauge, Monitor, Moon, Rows3, Rows4, Sun, Waves } from 'lucide-react';
import { useTheme as useNextThemesTheme } from 'next-themes';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AutoSaveHint from '@/components/Editor/AutoSaveHint';
import { CommonSectionSkeleton } from '@/components/Skeleton/Settings/tabs/Appearance';
import { FORM_STYLE } from '@/const/layoutTokens';
import { TIMEZONE_OPTIONS, type TimezoneOption } from '@/const/timezone';
import { imageUrl } from '@/const/url';
import { isDesktop } from '@/const/version';
import { SettingsSearchAnchor } from '@/features/SettingsSearch/anchor';
import { useSaveState } from '@/hooks/useSaveState';
import { localeOptions } from '@/locales/resources';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';
import { type LocaleMode } from '@/types/locale';
import { type UserGeneralConfig } from '@/types/user/settings';
import { preloadLang } from '@/utils/client/preloadLang';

/** Sentinel for "no explicit zone stored" — persisted as null, renders the browser zone. */
const TIMEZONE_AUTO = 'auto';

/** The stored `timezone` can be null; in the form it is always a concrete option value. */
type GeneralFormValues = Omit<UserGeneralConfig, 'timezone'> & { timezone: string };

const Common = memo(() => {
  const { t } = useTranslation('setting');

  const general = useUserStore((s) => settingsSelectors.currentSettings(s).general, isEqual);
  const { theme, setTheme } = useNextThemesTheme();
  const language = useGlobalStore(systemStatusSelectors.language);
  const [setSettings, isUserStateInit] = useUserStore((s) => [s.setSettings, s.isUserStateInit]);
  const [switchLocale, isStatusInit] = useGlobalStore((s) => [s.switchLocale, s.isStatusInit]);
  const { status: saveStatus, lastSavedAt, save, retry } = useSaveState();
  // `timezone: null` (follow system) maps to the sentinel for display; on the
  // way back the sentinel is converted to null so the stored value stays
  // "unset" — a plain undefined would be dropped by the settings merge and an
  // explicit string would shadow the browser probe forever. Memoized so an
  // unrelated rerender cannot hand `useForm` a fresh object and reset
  // in-flight edits; `general` itself is reference-stable via isEqual.
  const formValues = useMemo(
    () => ({ ...general, timezone: general.timezone || TIMEZONE_AUTO }),
    [general],
  );
  const form = useForm({
    initialValues: formValues,
    values: formValues,
    onValuesChange: (v) =>
      save(() =>
        setSettings({
          general: {
            ...v,
            timezone: v.timezone === TIMEZONE_AUTO ? null : v.timezone,
          },
        }),
      ),
  });

  // Use the theme value from next-themes, default to 'system'
  const currentTheme = theme || 'system';

  const handleLangChange = (value: LocaleMode) => {
    switchLocale(value);
  };

  if (!(isStatusInit && isUserStateInit)) return <CommonSectionSkeleton />;

  const themeFormGroup: FormGroupItem<GeneralFormValues> = {
    children: [
      {
        children: (
          <ImageSelect
            height={60}
            unoptimized={isDesktop}
            value={currentTheme}
            width={100}
            options={[
              {
                icon: Sun,
                img: imageUrl('theme_light.webp'),
                label: t('settingCommon.themeMode.light'),
                value: 'light',
              },
              {
                icon: Moon,
                img: imageUrl('theme_dark.webp'),
                label: t('settingCommon.themeMode.dark'),
                value: 'dark',
              },
              {
                icon: Monitor,
                img: imageUrl('theme_auto.webp'),
                label: t('settingCommon.themeMode.auto'),
                value: 'system',
              },
            ]}
            onChange={(value) => setTheme(value === 'auto' ? 'system' : value)}
          />
        ),
        label: (
          <SettingsSearchAnchor id={'appearance-theme-mode'}>
            {t('settingCommon.themeMode.title')}
          </SettingsSearchAnchor>
        ),
        minWidth: undefined,
      },
      {
        children: (
          <Flexbox horizontal justify={'flex-end'}>
            <Select
              defaultValue={language}
              optionRender={(option) => (
                <span
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  onMouseEnter={() => preloadLang(option.value as LocaleMode)}
                >
                  {option.label}
                </span>
              )}
              options={[
                { label: t('settingCommon.lang.autoMode'), value: 'auto' },
                ...localeOptions,
              ]}
              style={{
                width: '50%',
              }}
              onChange={handleLangChange}
            />
          </Flexbox>
        ),
        label: (
          <SettingsSearchAnchor id={'appearance-language'}>
            {t('settingCommon.lang.title')}
          </SettingsSearchAnchor>
        ),
      },
      {
        children: (
          <Select
            showSearch
            style={{ marginInlineStart: 'auto', width: '50%' }}
            optionRender={(option) => {
              const data = option as unknown as TimezoneOption;
              if (!data.offset)
                return (
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{data.label}</span>
                );
              return (
                <Flexbox horizontal gap={12} justify="space-between">
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{data.label}</span>
                  <span style={{ color: cssVar.colorTextDescription, fontSize: 12 }}>
                    {data.offset}
                  </span>
                </Flexbox>
              );
            }}
            options={[
              { label: t('settingCommon.timezone.autoMode'), value: TIMEZONE_AUTO },
              ...TIMEZONE_OPTIONS,
            ]}
          />
        ),
        desc: t('settingCommon.timezone.desc'),
        label: (
          <SettingsSearchAnchor id={'appearance-timezone'}>
            {t('settingCommon.timezone.title')}
          </SettingsSearchAnchor>
        ),
        name: 'timezone',
      },
      {
        children: (
          <Tabs
            items={[
              {
                icon: <Icon icon={Ban} size={16} />,
                key: 'disabled',
                label: t('settingAppearance.animationMode.disabled'),
              },
              {
                icon: <Icon icon={Gauge} size={16} />,
                key: 'agile',
                label: t('settingAppearance.animationMode.agile'),
              },
              {
                icon: <Icon icon={Waves} size={16} />,
                key: 'elegant',
                label: t('settingAppearance.animationMode.elegant'),
              },
            ]}
          />
        ),
        label: (
          <SettingsSearchAnchor id={'appearance-animation'}>
            {t('settingAppearance.animationMode.title')}
          </SettingsSearchAnchor>
        ),
        minWidth: undefined,
        name: 'animationMode',
        valueProp: 'activeKey',
      },
      {
        children: (
          <Tabs
            items={[
              {
                icon: <Icon icon={Rows4} size={16} />,
                key: 'compact',
                label: t('settingAppearance.density.compact'),
              },
              {
                icon: <Icon icon={Rows3} size={16} />,
                key: 'loose',
                label: t('settingAppearance.density.loose'),
              },
            ]}
          />
        ),
        desc: t('settingAppearance.density.desc'),
        label: (
          <SettingsSearchAnchor id={'appearance-density'}>
            {t('settingAppearance.density.title')}
          </SettingsSearchAnchor>
        ),
        minWidth: undefined,
        name: 'interfaceDensity',
        valueProp: 'activeKey',
      },
    ],
    extra: <AutoSaveHint lastUpdatedTime={lastSavedAt} saveStatus={saveStatus} onRetry={retry} />,
    title: t('settingCommon.title'),
  };

  return (
    <Form
      collapsible={false}
      form={form}
      items={[themeFormGroup]}
      itemsType={'group'}
      variant={'filled'}
      {...FORM_STYLE}
    />
  );
});

export default Common;
