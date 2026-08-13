import { manualModeExcludeToolIds } from '@lobechat/builtin-tools';
import type { LobeAgentChatConfig, RuntimeEnvMode } from '@lobechat/types';

interface ToolContextRefreshKeyOptions {
  agentId?: string;
  enableAgentMode?: boolean;
  hasAgentDocuments?: boolean;
  hasEnabledKnowledgeBases?: boolean;
  isModelBuiltinSearchInternal?: boolean;
  isModelHasBuiltinSearch?: boolean;
  isProviderHasBuiltinSearch?: boolean;
  memoryEnabled?: boolean;
  runtimeMode?: RuntimeEnvMode;
  searchMode?: LobeAgentChatConfig['searchMode'];
  skillActivateMode?: LobeAgentChatConfig['skillActivateMode'];
  useModelBuiltinSearch?: boolean;
}

export const getToolExcludeDefaultToolIds = (
  skillActivateMode?: LobeAgentChatConfig['skillActivateMode'],
) => (skillActivateMode === 'manual' ? manualModeExcludeToolIds : undefined);

export const getToolContextRefreshKey = ({
  agentId,
  enableAgentMode,
  hasAgentDocuments,
  hasEnabledKnowledgeBases,
  isModelBuiltinSearchInternal,
  isModelHasBuiltinSearch,
  isProviderHasBuiltinSearch,
  memoryEnabled,
  runtimeMode,
  searchMode,
  skillActivateMode,
  useModelBuiltinSearch,
}: ToolContextRefreshKeyOptions) =>
  [
    agentId || '',
    enableAgentMode === false ? 'chat' : 'agent',
    searchMode || 'auto',
    useModelBuiltinSearch ? 'model-search' : 'app-search',
    skillActivateMode || 'auto',
    memoryEnabled ? 'memory-on' : 'memory-off',
    hasEnabledKnowledgeBases ? 'knowledge-on' : 'knowledge-off',
    hasAgentDocuments ? 'documents-on' : 'documents-off',
    runtimeMode || 'none',
    isProviderHasBuiltinSearch ? 'provider-search-on' : 'provider-search-off',
    isModelHasBuiltinSearch ? 'model-search-on' : 'model-search-off',
    isModelBuiltinSearchInternal ? 'internal-search-on' : 'internal-search-off',
  ].join('|');

/**
 * Whether recorded context tokens still describe the payload the next send
 * would assemble. Stale when the topic changed or the agent mode switched
 * since the measurement — TokenTag then falls back to the live estimate.
 */
export const isContextTokensCurrent = (
  contextTokens: { mode?: string; topicId?: string } | undefined,
  activeTopicId?: string,
  currentMode?: string,
) =>
  !!contextTokens &&
  contextTokens.topicId === activeTopicId &&
  // Legacy entries without a mode stamp stay valid (pre-mode behavior).
  (!contextTokens.mode || contextTokens.mode === currentMode);
