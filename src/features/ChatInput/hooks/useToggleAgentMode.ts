'use client';

import { useCallback } from 'react';

import { useBusinessCanEnableAgentMode } from '@/business/client/hooks/useBusinessAgentMode';
import { useAgentManagementAccess } from '@/features/ResourcePermission/useAgentManagementAccess';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useUserStore } from '@/store/user';

import { useAgentId } from './useAgentId';
import { type ChatInputMode } from './useEffectiveAgentMode';
import { useUpdateAgentConfig } from './useUpdateAgentConfig';

/**
 * Map a chat mode to its `enableAgentMode` + `promptMode` pair.
 *   - agent:     agent + full   (upstream byte-identical)
 *   - efficient: agent + lean   (token optimization — our only divergence)
 *   - chat:      chat + full    (upstream byte-identical; lean is never used
 *                                 outside efficient mode)
 */
export const resolveModeFlags = (
  mode: ChatInputMode,
): { enableAgentMode: boolean; promptMode: 'full' | 'lean' } => {
  switch (mode) {
    case 'agent': {
      return { enableAgentMode: true, promptMode: 'full' };
    }
    case 'efficient': {
      return { enableAgentMode: true, promptMode: 'lean' };
    }
    case 'chat':
    default: {
      return { enableAgentMode: false, promptMode: 'full' };
    }
  }
};

/**
 * Toggle between chat mode and agent mode.
 *
 * The flag is stored on `chatConfig.enableAgentMode` so it persists (chat_config
 * is a jsonb column) and is readable on the server. The `plugins` array is left
 * untouched — chat mode is enforced at the runtime tools engine layer.
 */
export const useToggleAgentMode = () => {
  const agentId = useAgentId();
  const { updateAgentChatConfig } = useUpdateAgentConfig();
  const canEnableBusinessAgentMode = useBusinessCanEnableAgentMode(agentId);
  const agent = useAgentStore(agentByIdSelectors.getAgentById(agentId));
  const { canManageAgent, isAccessLoading } = useAgentManagementAccess(agentId);
  const usesWorkspaceMemberMode =
    !!agent?.workspaceId && agent.visibility !== 'private' && !canManageAgent;
  const updateWorkspaceUserPreference = useUserStore((s) => s.updateWorkspaceUserPreference);

  return useCallback(
    async (mode: ChatInputMode) => {
      if (isAccessLoading) return;

      const { enableAgentMode, promptMode } = resolveModeFlags(mode);
      const effectiveEnableAgentMode = enableAgentMode && canEnableBusinessAgentMode;
      if (usesWorkspaceMemberMode) {
        // Workspace member mode only carries the agent/chat flag today.
        await updateWorkspaceUserPreference({
          agentModeOverrides: { [agentId]: effectiveEnableAgentMode },
        });
        return;
      }

      await updateAgentChatConfig({ enableAgentMode: effectiveEnableAgentMode, promptMode });
    },
    [
      agentId,
      canEnableBusinessAgentMode,
      isAccessLoading,
      updateAgentChatConfig,
      updateWorkspaceUserPreference,
      usesWorkspaceMemberMode,
    ],
  );
};
