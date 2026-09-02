import { Icon } from '@lobehub/ui';
import { type MenuItemType } from 'antd/es/menu/interface';
import { Handshake, LinkIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { type MenuProps } from '@/components/Menu';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { ChatSettingsTabs } from '@/store/global/initialState';

interface UseCategoryOptions {
  mobile?: boolean;
}

export const useCategory = ({ mobile }: UseCategoryOptions = {}) => {
  const { t } = useTranslation('setting');
  const iconSize = mobile ? 20 : undefined;
  const isInbox = useAgentStore(builtinAgentSelectors.isInboxAgent);

  const cateItems: MenuProps['items'] = useMemo(
    () =>
      [
        // Agent profile editing lives on /agent/:aid/profile. The legacy Prompt
        // tab had no renderer in AgentSettingsContent and showed a blank panel.
        (!isInbox && {
          icon: <Icon icon={Handshake} size={iconSize} />,
          key: ChatSettingsTabs.Opening,
          label: t('agentTab.opening'),
        }) as MenuItemType,
        {
          icon: <Icon icon={LinkIcon} size={iconSize} />,
          key: ChatSettingsTabs.Connector,
          label: t('agentTab.connector', 'Connectors'),
        },
      ].filter(Boolean) as MenuProps['items'],
    [t, isInbox, iconSize],
  );

  return cateItems;
};
