import { ChatSettingsTabs } from '@/store/global/initialState';

export const resolveChatSettingsTab = (
  requestedTab: ChatSettingsTabs,
  availableTabs: readonly string[],
): ChatSettingsTabs => {
  if (availableTabs.includes(requestedTab)) return requestedTab;

  return (availableTabs[0] as ChatSettingsTabs | undefined) ?? ChatSettingsTabs.Connector;
};
