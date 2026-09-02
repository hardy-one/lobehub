import { type CollapseProps } from 'antd';
import isEqual from 'fast-deep-equal';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useHomeAgentRows } from '@/features/Home/AgentSelect/useHomeAgentRows';
import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import { useFetchSessions } from '@/hooks/useFetchSessions';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useServerConfigStore } from '@/store/serverConfig';
import { serverConfigSelectors } from '@/store/serverConfig/selectors';
import { useSessionStore } from '@/store/session';
import { sessionSelectors } from '@/store/session/selectors';
import { type LobeAgentSession, type LobeSessions } from '@/types/session';
import { LobeSessionType, SessionDefaultGroup } from '@/types/session';

import { AgentSearchList } from './AgentSearchList';
import CollapseGroup from './CollapseGroup';
import Actions from './CollapseGroup/Actions';
import { getMobileAgentOnlyRows } from './getMobileAgentOnlyRows';
import Inbox from './Inbox';
import SessionList from './List';
import ConfigGroupModal from './Modals/ConfigGroupModal';
import { openRenameGroupModal } from './Modals/RenameGroupModal';

const DefaultMode = memo(() => {
  const { t } = useTranslation('chat');

  const [configGroupModalOpen, setConfigGroupModalOpen] = useState(false);

  useFetchSessions();
  useFetchAgentList();

  const isMobile = useServerConfigStore(serverConfigSelectors.isMobile);

  const defaultSessions = useSessionStore(sessionSelectors.defaultSessions, isEqual);
  const customSessionGroups = useSessionStore(sessionSelectors.customSessionGroups, isEqual);
  const pinnedSessions = useSessionStore(sessionSelectors.pinnedSessions, isEqual);
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const { privateRows, workspaceRows } = useHomeAgentRows();

  const shouldHideSession = (session: LobeSessions[0]) =>
    !isMobile &&
    session.type === LobeSessionType.Agent &&
    Boolean((session as LobeAgentSession).config?.virtual);

  const filterSessionsForView = (sessions: LobeSessions): LobeSessions => {
    const filteredForDevice = isMobile
      ? sessions.filter((session) => session.type !== LobeSessionType.Group)
      : sessions;

    if (isMobile) return filteredForDevice;

    return filteredForDevice.filter((session) => !shouldHideSession(session));
  };

  const filteredDefaultSessions = filterSessionsForView(defaultSessions);
  const filteredPinnedSessions = filterSessionsForView(pinnedSessions);
  const filteredCustomSessionGroups = customSessionGroups?.map((group) => ({
    ...group,
    children: filterSessionsForView(group.children),
  }));

  const sessionsForAgentLookup = useMemo(
    () => [
      ...defaultSessions,
      ...pinnedSessions,
      ...(customSessionGroups?.flatMap((group) => group.children) || []),
    ],
    [customSessionGroups, defaultSessions, pinnedSessions],
  );
  const mobileAgentOnlyRows = useMemo(
    () =>
      isMobile
        ? getMobileAgentOnlyRows(
            [...privateRows, ...workspaceRows],
            sessionsForAgentLookup,
            inboxAgentId,
          )
        : [],
    [inboxAgentId, isMobile, privateRows, sessionsForAgentLookup, workspaceRows],
  );

  const activeWorkspaceId = useActiveWorkspaceId();
  const sessionGroupKeys = useGlobalStore(
    systemStatusSelectors.sessionGroupKeys(activeWorkspaceId),
  );
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

  const items = useMemo(
    () =>
      [
        filteredPinnedSessions &&
          filteredPinnedSessions.length > 0 && {
            children: <SessionList dataSource={filteredPinnedSessions} />,
            extra: <Actions isPinned openConfigModal={() => setConfigGroupModalOpen(true)} />,
            key: SessionDefaultGroup.Pinned,
            label: t('pin'),
          },
        ...(filteredCustomSessionGroups || []).map(({ id, name, children }) => ({
          children: <SessionList dataSource={children} groupId={id} />,
          extra: (
            <Actions
              isCustomGroup
              id={id}
              openConfigModal={() => setConfigGroupModalOpen(true)}
              openRenameModal={() => openRenameGroupModal(id)}
            />
          ),
          key: id,
          label: name,
        })),
        {
          children: (
            <>
              <SessionList dataSource={filteredDefaultSessions || []} />
              <AgentSearchList dataSource={mobileAgentOnlyRows} />
            </>
          ),
          extra: <Actions openConfigModal={() => setConfigGroupModalOpen(true)} />,
          key: SessionDefaultGroup.Default,
          label: t('defaultList'),
        },
      ].filter(Boolean) as CollapseProps['items'],
    [
      filteredCustomSessionGroups,
      filteredDefaultSessions,
      filteredPinnedSessions,
      mobileAgentOnlyRows,
      t,
    ],
  );

  return (
    <>
      <Inbox />
      <CollapseGroup
        activeKey={sessionGroupKeys}
        items={items}
        onChange={(keys) => {
          const expandSessionGroupKeys = typeof keys === 'string' ? [keys] : keys;
          updateSystemStatus({ expandSessionGroupKeys });
        }}
      />
      <ConfigGroupModal
        open={configGroupModalOpen}
        onCancel={() => setConfigGroupModalOpen(false)}
      />
    </>
  );
});

DefaultMode.displayName = 'SessionDefaultMode';

export default DefaultMode;
