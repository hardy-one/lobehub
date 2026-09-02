import type { SidebarAgentItem } from '@lobechat/types';

import type { AgentRow } from '@/features/Home/AgentSelect/useHomeAgentRows';
import type { LobeSessions } from '@/types/session';

/**
 * Return visible agents that are not represented by a session yet.
 *
 * Mobile home historically renders the session list. Agents created through
 * Connect Agent can exist before their first session, so keep those agents in
 * the mobile list without manufacturing a session-store record for them.
 */
export const getMobileAgentOnlyRows = (
  rows: AgentRow[],
  sessions: LobeSessions,
  inboxAgentId?: string,
): SidebarAgentItem[] => {
  const sessionAgentIds = new Set(
    sessions.flatMap((session) =>
      session.type === 'agent' && session.config?.id ? [session.config.id] : [],
    ),
  );

  return rows
    .filter(({ id }) => id !== inboxAgentId && !sessionAgentIds.has(id))
    .map((row) => ({
      avatar: row.avatar,
      backgroundColor: row.backgroundColor,
      heterogeneousType: row.heterogeneousType,
      id: row.id,
      pinned: row.pinned ?? false,
      title: row.title,
      type: 'agent' as const,
      updatedAt: row.updatedAt ?? new Date(),
    }));
};
