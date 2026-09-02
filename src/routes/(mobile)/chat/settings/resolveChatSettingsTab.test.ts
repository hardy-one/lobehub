import { describe, expect, it } from 'vitest';

import { ChatSettingsTabs } from '@/store/global/initialState';

import { resolveChatSettingsTab } from './resolveChatSettingsTab';

describe('resolveChatSettingsTab', () => {
  it('falls back to the first rendered tab instead of an unsupported blank tab', () => {
    expect(
      resolveChatSettingsTab(ChatSettingsTabs.Prompt, [
        ChatSettingsTabs.Opening,
        ChatSettingsTabs.Connector,
      ]),
    ).toBe(ChatSettingsTabs.Opening);
  });

  it('preserves the requested tab when it is available', () => {
    expect(
      resolveChatSettingsTab(ChatSettingsTabs.Connector, [
        ChatSettingsTabs.Opening,
        ChatSettingsTabs.Connector,
      ]),
    ).toBe(ChatSettingsTabs.Connector);
  });

  it('uses Connector as the safe fallback when no tab is available', () => {
    expect(resolveChatSettingsTab(ChatSettingsTabs.Prompt, [])).toBe(ChatSettingsTabs.Connector);
  });
});
