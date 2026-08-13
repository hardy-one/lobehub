import {
  type AgentDeviceOverride,
  type LobeAgentAgencyConfig,
  resolveAgentAgencyConfig,
} from '@lobechat/types';

import { applyTopicDeviceBinding } from './executionTarget';

export const resolveBrowserDeviceScope = ({
  agencyConfig,
  canManage,
  currentDeviceId,
  deviceOverride,
  preferenceWorkspaceId,
  topicDeviceId,
  visibility,
  workspaceId,
}: {
  agencyConfig?: LobeAgentAgencyConfig;
  canManage: boolean;
  currentDeviceId?: string;
  deviceOverride?: AgentDeviceOverride;
  preferenceWorkspaceId?: string | null;
  topicDeviceId?: string;
  visibility?: 'private' | 'public';
  workspaceId?: string | null;
}): 'personal' | 'workspace' => {
  if (!workspaceId) return 'personal';
  // The store preference bucket is not keyed: never consume another workspace's selection.
  const override = preferenceWorkspaceId === workspaceId ? deviceOverride : undefined;
  const resolved = resolveAgentAgencyConfig(agencyConfig, override, {
    canManage,
    visibility,
    workspaceId,
  });
  const effective = applyTopicDeviceBinding(
    { agencyConfig: resolved, workspaceScoped: !override?.executionTarget },
    topicDeviceId,
    currentDeviceId,
  ).agencyConfig;
  return override?.executionTarget === 'local' && effective?.executionTarget === 'local'
    ? 'personal'
    : 'workspace';
};
