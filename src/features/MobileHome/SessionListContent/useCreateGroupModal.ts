import { type SidebarAgentItem } from '@lobechat/types';
import { useCallback } from 'react';

import { openCreateGroupModal } from './Modals/CreateGroupModal';

interface CreateGroupTarget {
  id: string;
  type: SidebarAgentItem['type'];
  visibility?: SidebarAgentItem['visibility'];
}

/**
 * Rows of the mobile list open the category builder through the mobile modal
 * helper.
 *
 * The mobile layout mounts no `AgentModalProvider`, so the desktop context that
 * desktop rows read (`useOptionalAgentModal`) is always `null` on this surface —
 * the row menu's "Add New Category" entry used to close the menu and do nothing.
 * Binding the row's own target to the mobile helper keeps the search list on the
 * same creation flow as the rest of the mobile list.
 */
export const useCreateGroupModal = ({ id, type, visibility }: CreateGroupTarget) =>
  useCallback(() => openCreateGroupModal(id, type, visibility), [id, type, visibility]);
