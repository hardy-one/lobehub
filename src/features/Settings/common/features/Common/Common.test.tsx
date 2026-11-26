import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Common from './Common';

const { state, setSettings } = vi.hoisted(() => ({
  setSettings: vi.fn().mockResolvedValue(undefined),
  state: {
    general: {
      animationMode: 'agile',
      interfaceDensity: 'loose',
      timezone: 'Asia/Shanghai' as string | null,
    },
  },
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: any) => <div>{children}</div>,
  Icon: () => null,
  ImageSelect: () => null,
  Select: ({ onChange, options, value, defaultValue }: any) => (
    <select
      value={value ?? defaultValue}
      aria-label={
        options.some((option: any) => option.value === 'Asia/Singapore') ? 'timezone' : 'language'
      }
      onChange={(event) => onChange?.(event.target.value)}
    >
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
  Tabs: ({ activeKey, onChange }: any) => (
    <button onClick={() => onChange?.('compact')}>{activeKey}</button>
  ),
}));
vi.mock('@lobehub/ui/stylex/cssVar.stylex', () => ({ cssVar: { colorTextDescription: '#888' } }));
vi.mock('@/const/layoutTokens', () => ({ FORM_STYLE: {} }));
vi.mock('@/const/url', () => ({ imageUrl: (path: string) => path }));
vi.mock('@/const/version', () => ({ isDesktop: false }));
vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'system', setTheme: vi.fn() }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/components/Editor/AutoSaveHint', () => ({ default: () => null }));
vi.mock('@/components/Skeleton/Settings/tabs/Appearance', () => ({
  CommonSectionSkeleton: () => null,
}));
vi.mock('@/features/SettingsSearch/anchor', () => ({
  SettingsSearchAnchor: ({ children }: any) => <>{children}</>,
}));
vi.mock('@/const/timezone', () => ({
  TIMEZONE_OPTIONS: [
    { label: 'Singapore', value: 'Asia/Singapore' },
    { label: 'Shanghai', value: 'Asia/Shanghai' },
  ],
}));
vi.mock('@/locales/resources', () => ({ localeOptions: [] }));
vi.mock('@/utils/client/preloadLang', () => ({ preloadLang: vi.fn() }));
vi.mock('@/store/global/selectors', () => ({
  systemStatusSelectors: { language: (s: any) => s.language },
}));
vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: any) =>
    selector({ language: 'auto', switchLocale: vi.fn(), isStatusInit: true }),
}));
vi.mock('@/store/user/selectors', () => ({ settingsSelectors: { currentSettings: () => state } }));
vi.mock('@/store/user', () => ({
  useUserStore: (selector: any) => selector({ setSettings, isUserStateInit: true }),
}));

describe('common settings timezone', () => {
  beforeEach(() => {
    setSettings.mockClear();
    state.general.timezone = 'Asia/Shanghai';
  });

  it('saves a selected timezone and follow-system as null', async () => {
    render(<Common />);
    const timezone = screen.getByLabelText('timezone');
    expect(timezone).toHaveValue('Asia/Shanghai');
    fireEvent.change(timezone, { target: { value: 'Asia/Singapore' } });
    await waitFor(() =>
      expect(setSettings).toHaveBeenCalledWith({ general: { timezone: 'Asia/Singapore' } }),
    );
    console.log('Asia/Singapore setSettings:', JSON.stringify(setSettings.mock.lastCall));
    fireEvent.change(timezone, { target: { value: 'auto' } });
    await waitFor(() =>
      expect(setSettings).toHaveBeenLastCalledWith({ general: { timezone: null } }),
    );
    console.log('Follow system setSettings:', JSON.stringify(setSettings.mock.lastCall));
  });

  it('shows the persisted timezone on reload and keeps other field saves', async () => {
    state.general.timezone = 'Asia/Singapore';
    render(<Common />);
    expect(screen.getByLabelText('timezone')).toHaveValue('Asia/Singapore');
    console.log(
      'Saved Asia/Singapore; rendered selected value:',
      (screen.getByLabelText('timezone') as HTMLSelectElement).value,
    );
    console.log('Rendered select:', screen.getByLabelText('timezone').outerHTML);
    fireEvent.click(screen.getByText('loose'));
    await waitFor(() =>
      expect(setSettings).toHaveBeenCalledWith({
        general: { interfaceDensity: 'compact', timezone: undefined },
      }),
    );
  });

  it('shows follow system for a saved null timezone', () => {
    state.general.timezone = null;
    render(<Common />);
    const timezone = screen.getByLabelText('timezone') as HTMLSelectElement;
    expect(timezone).toHaveValue('auto');
    console.log(
      'Saved null; rendered selected value:',
      timezone.value,
      'label:',
      timezone.selectedOptions[0].textContent,
    );
    console.log('Saved null; rendered select:', timezone.outerHTML);
  });
});
