import { AGENT_CHAT_URL, DEFAULT_AVATAR, GROUP_CHAT_URL } from '@lobechat/const';
import type { SidebarAgentItem } from '@lobechat/types';
import { agentDisplayName } from '@lobechat/types';
import { Tag } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import LazyLoad from 'react-lazy-load';

import { useAgentDropdownMenu } from '@/features/HomeSidebar/Body/Agent/List/AgentItem/useDropdownMenu';
import Actions from '@/features/HomeSidebar/Body/Agent/List/Item/Actions';
import { useOptionalAgentModal } from '@/features/HomeSidebar/Body/Agent/ModalProvider';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useServerConfigStore } from '@/store/serverConfig';

import { getHeterogeneousTypeLabel } from './getHeterogeneousTypeLabel';
import ListItem from './ListItem';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    min-height: 70px;
  `,
  link: css`
    display: block;
  `,
}));

interface AgentSearchListProps {
  dataSource?: SidebarAgentItem[];
}

interface AgentSearchItemProps {
  item: SidebarAgentItem;
}

const AgentSearchItem = memo<AgentSearchItemProps>(({ item }) => {
  const { t } = useTranslation('chat');
  const isMobile = useServerConfigStore((s) => s.isMobile);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const agentModal = useOptionalAgentModal();

  const title = agentDisplayName(item, t('untitledAgent'));
  const heterogeneousLabel = getHeterogeneousTypeLabel(item.heterogeneousType);
  const dropdownMenu = useAgentDropdownMenu({
    anchor,
    avatar: typeof item.avatar === 'string' ? item.avatar : undefined,
    backgroundColor: item.backgroundColor || undefined,
    group: undefined,
    id: item.id,
    labels: item.labels,
    openCreateGroupModal: () => agentModal?.openCreateGroupModal(item.id, item.visibility),
    pinned: item.pinned,
    slug: item.slug,
    title: title ?? t('untitledAgent'),
    userId: item.userId,
    visibility: item.visibility,
  });

  return (
    <LazyLoad className={styles.container}>
      <WorkspaceLink
        aria-label={title}
        className={styles.link}
        ref={setAnchor}
        to={AGENT_CHAT_URL(item.id, isMobile)}
      >
        <ListItem
          actions={<Actions dropdownMenu={dropdownMenu} />}
          addon={heterogeneousLabel ? <Tag size="small">{heterogeneousLabel}</Tag> : undefined}
          avatar={item.avatar || DEFAULT_AVATAR}
          avatarBackground={item.backgroundColor || undefined}
          pin={item.pinned}
          title={title}
          type={item.type}
          styles={{
            container: {
              gap: 12,
            },
            content: {
              gap: 6,
              maskImage: `linear-gradient(90deg, #000 90%, transparent)`,
            },
          }}
        />
      </WorkspaceLink>
    </LazyLoad>
  );
});

AgentSearchItem.displayName = 'AgentSearchItem';

const GroupSearchItem = memo<AgentSearchItemProps>(({ item }) => {
  const { t } = useTranslation('chat');
  const title = agentDisplayName(item, t('untitledAgent'));

  return (
    <LazyLoad className={styles.container}>
      <WorkspaceLink aria-label={title} className={styles.link} to={GROUP_CHAT_URL(item.id)}>
        <ListItem
          avatar={item.avatar || DEFAULT_AVATAR}
          avatarBackground={item.backgroundColor || undefined}
          title={title}
          type={item.type}
          styles={{
            container: {
              gap: 12,
            },
            content: {
              gap: 6,
              maskImage: `linear-gradient(90deg, #000 90%, transparent)`,
            },
          }}
        />
      </WorkspaceLink>
    </LazyLoad>
  );
});

GroupSearchItem.displayName = 'GroupSearchItem';

export const AgentSearchList = memo<AgentSearchListProps>(({ dataSource }) =>
  dataSource?.map((item) =>
    item.type === 'group' ? (
      <GroupSearchItem item={item} key={item.id} />
    ) : (
      <AgentSearchItem item={item} key={item.id} />
    ),
  ),
);

AgentSearchList.displayName = 'AgentSearchList';
