import type { AgentContextMode, AgentItem, LobeAgentChatConfig } from '@lobechat/types';

import { useAgentManagementAccess } from '@/features/ResourcePermission/useAgentManagementAccess';
import { getAgentStoreState, useAgentStore } from '@/store/agent';
import { agentByIdSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

interface EffectiveAgentModePreferenceSources {
  agent?: Pick<Partial<AgentItem>, 'userId' | 'visibility' | 'workspaceId'>;
  currentUserId?: string;
  memberContextModeOverride?: AgentContextMode;
  memberModeOverride?: boolean;
  sharedContextMode?: AgentContextMode;
  sharedEnableAgentMode: boolean;
  sharedToolMode?: LobeAgentChatConfig['toolMode'];
}

const resolveEffectiveAgentModePreference = ({
  agent,
  currentUserId,
  memberContextModeOverride,
  memberModeOverride,
  sharedContextMode,
  sharedEnableAgentMode,
  sharedToolMode,
}: EffectiveAgentModePreferenceSources) => {
  const isAuthor = !!currentUserId && agent?.userId === currentUserId;
  const usesWorkspaceMemberMode =
    !!agent?.workspaceId && agent.visibility !== 'private' && !isAuthor;

  if (!usesWorkspaceMemberMode) {
    return {
      contextMode: sharedContextMode,
      enableAgentMode: sharedEnableAgentMode,
      toolMode: sharedToolMode,
    };
  }

  return {
    contextMode: memberContextModeOverride ?? sharedContextMode,
    enableAgentMode: memberModeOverride ?? sharedEnableAgentMode,
    toolMode: sharedToolMode,
  };
};

/** Resolve the Chat/Agent preference used by generation for this agent. */
export const getEffectiveAgentModePreference = (agentId: string) => {
  const agentState = getAgentStoreState();
  const userState = useUserStore.getState();
  const agent = agentByIdSelectors.getAgentById(agentId)(agentState);
  const currentUserId = userProfileSelectors.userId(userState);
  const isAuthor = !!currentUserId && agent?.userId === currentUserId;
  const usesWorkspaceMemberMode =
    !!agent?.workspaceId && agent.visibility !== 'private' && !isAuthor;

  // The preference store is intentionally unkeyed. Until the active Workspace
  // has hydrated it, its contents may belong to the previous Workspace. Send
  // validation must therefore fail closed instead of exposing the Agent-only
  // media fallback with a stale/default preference.
  if (
    usesWorkspaceMemberMode &&
    userState.workspaceUserPreferenceWorkspaceId !== agent.workspaceId
  ) {
    return false;
  }

  return resolveEffectiveAgentModePreference({
    agent,
    currentUserId,
    memberModeOverride: userState.workspaceUserPreference.agentModeOverrides?.[agentId],
    sharedEnableAgentMode: agentByIdSelectors.getAgentEnableModeById(agentId)(agentState),
  }).enableAgentMode;
};

/** Reactive counterpart used by capability-gated chat input controls. */
export const useEffectiveAgentModePreference = (agentId: string) => {
  const [agent, sharedEnableAgentMode, sharedContextMode, sharedToolMode] =
    useAgentStore((state) => [
      agentByIdSelectors.getAgentById(agentId)(state),
      agentByIdSelectors.getAgentEnableModeById(agentId)(state),
      chatConfigByIdSelectors.getContextModeById(agentId)(state),
      chatConfigByIdSelectors.getChatConfigById(agentId)(state).toolMode,
    ]);
  const { canManageAgent, isAccessLoading } = useAgentManagementAccess(agentId);
  const usesWorkspaceMemberMode =
    !!agent?.workspaceId && agent.visibility !== 'private' && !canManageAgent;
  const storePreference = useUserStore((state) => state.workspaceUserPreference);
  const { data: fetchedPreference, isLoading } = useUserStore(
    (state) => state.useFetchWorkspaceUserPreference,
  )();
  const preference = fetchedPreference === undefined ? storePreference : (fetchedPreference ?? {});

  return {
    ...resolveEffectiveAgentModePreference({
      agent,
      memberContextModeOverride: usesWorkspaceMemberMode
        ? preference.agentContextModeOverrides?.[agentId]
        : undefined,
      memberModeOverride: usesWorkspaceMemberMode
        ? preference.agentModeOverrides?.[agentId]
        : undefined,
      sharedContextMode,
      sharedEnableAgentMode,
      sharedToolMode,
    }),
    isPreferenceLoading: isAccessLoading || (usesWorkspaceMemberMode && isLoading),
    usesWorkspaceMemberMode,
  };
};

export { resolveEffectiveAgentModePreference };
