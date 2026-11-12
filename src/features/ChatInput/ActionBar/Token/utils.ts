import { manualModeExcludeToolIds } from '@lobechat/builtin-tools';
import type { LobeAgentChatConfig, ModelUsage, RuntimeEnvMode } from '@lobechat/types';

interface ToolContextRefreshKeyOptions {
  agentId?: string;
  enableAgentMode?: boolean;
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
    runtimeMode || 'none',
    isProviderHasBuiltinSearch ? 'provider-search-on' : 'provider-search-off',
    isModelHasBuiltinSearch ? 'model-search-on' : 'model-search-off',
    isModelBuiltinSearchInternal ? 'internal-search-on' : 'internal-search-off',
  ].join('|');

export interface ProviderUsageMessage {
  error?: unknown;
  id: string;
  role: string;
  usage?: ModelUsage;
}

export interface ProviderUsageSnapshot {
  id: string;
  index: number;
  inputTokens: number;
}

/**
 * Provider input usage is the uncached input plus cache read/write tokens.
 * `totalInputTokens` is kept as a fallback because some providers omit the
 * cache breakdown, while a cache-only breakdown must remain usable on its own.
 */
export const getProviderInputTokens = (usage?: ModelUsage): number | undefined => {
  if (!usage) return;

  const cacheRead = typeof usage.inputCachedTokens === 'number' ? usage.inputCachedTokens : 0;
  const cacheWrite =
    typeof usage.inputWriteCacheTokens === 'number' ? usage.inputWriteCacheTokens : 0;
  const hasCacheBreakdown =
    typeof usage.inputCacheMissTokens === 'number' ||
    typeof usage.inputCachedTokens === 'number' ||
    typeof usage.inputWriteCacheTokens === 'number';

  if (hasCacheBreakdown) {
    const input =
      typeof usage.inputCacheMissTokens === 'number'
        ? usage.inputCacheMissTokens
        : typeof usage.totalInputTokens === 'number'
          ? Math.max(0, usage.totalInputTokens - cacheRead - cacheWrite)
          : typeof usage.inputTextTokens === 'number'
            ? usage.inputTextTokens
            : 0;

    return Math.max(0, input) + cacheRead + cacheWrite;
  }

  if (typeof usage.totalInputTokens === 'number') return Math.max(0, usage.totalInputTokens);
  if (typeof usage.inputTextTokens === 'number') return Math.max(0, usage.inputTextTokens);

  const legacyInputTokens = (usage as ModelUsage & { inputTokens?: unknown }).inputTokens;
  return typeof legacyInputTokens === 'number' ? Math.max(0, legacyInputTokens) : undefined;
};

export const getLatestProviderUsage = (
  messages: readonly ProviderUsageMessage[],
): ProviderUsageSnapshot | undefined => {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== 'assistant' || message.error || !message.usage) continue;

    const inputTokens = getProviderInputTokens(message.usage);
    if (inputTokens === undefined) continue;

    return { id: message.id, index, inputTokens };
  }
};
