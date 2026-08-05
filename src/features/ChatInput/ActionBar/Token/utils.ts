import { efficientDeferredPluginIds, manualModeExcludeToolIds } from '@lobechat/builtin-tools';
import type { UiTokenBreakdown } from '@lobechat/context-engine';
import { LEAN_TOOL_USAGE_POLICY, ToolNameResolver } from '@lobechat/context-engine';
import { availableToolsPrompts, pluginPrompts, skillsPrompts } from '@lobechat/prompts';
import type { LobeAgentChatConfig, RuntimeEnvMode } from '@lobechat/types';
import { estimateTokenCount } from 'tokenx';

import { createAgentToolsEngine } from '@/helpers/toolEngineering';
import { getToolStoreState } from '@/store/tool';
import { pluginHelpers } from '@/store/tool/helpers';
import { toolSelectors } from '@/store/tool/selectors';

export interface TokenBreakdown {
  chats: number;
  historySummary: number;
  systemRole: number;
  tools: number;
}

export interface TokenEstimateInput {
  agentId: string;
  /** Draft after applyInputTemplate — counted inside the chats bucket. */
  draft?: string;
  enableAgentMode?: boolean;
  historySummary?: string;
  /** The display window of the conversation (same truncation the send uses). */
  messages: Array<{ content?: unknown }>;
  model: string;
  /** promptUserMemory output (persona + topic memories), like the real send. */
  personaText?: string;
  pluginIds: string[];
  promptMode?: 'full' | 'lean';
  provider: string;
  skillActivateMode?: 'auto' | 'manual';
  systemRole?: string;
}

const toolNameResolver = new ToolNameResolver();

const count = (text: string | undefined): number => (text ? estimateTokenCount(text) : 0);

/** Count tokens of a text chunk with the same estimator the buckets use. */
export const countText = (text: string | undefined): number =>
  text ? estimateTokenCount(text) : 0;

export interface StoredContextBaseline {
  /**
   * UI bucket breakdown of the measured request (systemRole/persona,
   * tools+skills+policy, history summary, chats) — persisted by the send
   * side when available.
   */
  breakdown?: UiTokenBreakdown;
  /** Id of the last message covered by the stored token count (anchor). */
  lastMsgId: string;
  /** Real provider-measured context tokens of the last completed request. */
  tokens: number;
}

/**
 * Context total from the real stored baseline + an estimate of everything
 * added since (messages after the anchor + the in-progress draft). Same
 * semantics as the compression baseline path in agent-runtime, but without
 * drift (UI displays the raw estimate).
 *
 * Returns `undefined` (caller falls back to pure estimation) when there is
 * no baseline or the anchor message is no longer in the window (compressed /
 * deleted / truncated out — the stored value no longer describes the set).
 */
/**
 * Token delta since the stored baseline anchor: window messages after the
 * anchor + the in-progress draft. Shared by `estimateContextTotal` (baseline
 * + delta) and the real-breakdown display path (the delta lands in the
 * chats bucket).
 */
export const estimateContextDelta = (input: {
  draft?: string;
  messages: Array<{ content?: unknown; id?: string }>;
  storedContext?: StoredContextBaseline | null;
}): number => {
  const { draft, messages, storedContext } = input;
  if (!storedContext) return 0;

  const anchorIndex = messages.findIndex((m) => m.id === storedContext.lastMsgId);
  if (anchorIndex < 0) return 0;

  const deltaText = messages
    .slice(anchorIndex + 1)
    .map((m) => (typeof m.content === 'string' ? m.content : ''))
    .join('');

  return countText(deltaText) + countText(draft);
};

export const estimateContextTotal = (input: {
  draft?: string;
  messages: Array<{ content?: unknown; id?: string }>;
  storedContext?: StoredContextBaseline | null;
}): number | undefined => {
  const { messages, storedContext } = input;
  if (!storedContext) return undefined;
  // The anchor must still be in the window — otherwise the stored value no
  // longer describes the set (compressed / deleted / truncated out).
  if (!messages.some((m) => m.id === storedContext.lastMsgId)) return undefined;
  return storedContext.tokens + estimateContextDelta(input);
};

/**
 * Distribute a (real) target total across the estimated buckets, keeping
 * their relative proportions, so the displayed sum is self-consistent with
 * the real baseline + delta total while the per-category split stays
 * estimate-based (the stored baseline has no type information).
 */
export const scaleBreakdown = (breakdown: TokenBreakdown, targetTotal: number): TokenBreakdown => {
  const estimatedTotal =
    breakdown.chats + breakdown.historySummary + breakdown.systemRole + breakdown.tools;
  if (estimatedTotal <= 0) return breakdown;
  const scale = targetTotal / estimatedTotal;
  return {
    chats: Math.round(breakdown.chats * scale),
    historySummary: Math.round(breakdown.historySummary * scale),
    systemRole: Math.round(breakdown.systemRole * scale),
    tools: Math.round(breakdown.tools * scale),
  };
};

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

/**
 * Fingerprint of every store input that shapes the tools bucket (the
 * createAgentToolsEngine implicit inputs: KB/local-system/memory/search
 * gates). TokenTag recomputes the breakdown when it changes — mirrors the
 * send path where these gates change the generated tool set.
 */
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

/**
 * Pure per-category token estimate for TokenTag.
 *
 * The tools bucket is generated with the SAME functions the real send uses
 * (createAgentToolsEngine → generateToolsDetailed → composeEnabledTools +
 * the prompt components), so efficient-mode deferral, teaching blocks /
 * policy, the skills index and the available-tools directory track the real
 * payload by construction — no mirroring to drift. Everything is a store read
 * plus string assembly: no network, no cache, no async.
 *
 * The chats bucket counts the display window (same truncation as the send)
 * plus the templated draft; systemRole counts the role plus the injected
 * persona. Known undercounts (accepted for a pressure indicator): date/model
 * system injections (~100-200 tokens) and page-editor document injection.
 */
export const estimateTokenBreakdown = (input: TokenEstimateInput): TokenBreakdown => {
  const {
    agentId,
    model,
    provider,
    pluginIds,
    promptMode,
    enableAgentMode,
    skillActivateMode,
    messages,
    draft,
    systemRole,
    personaText,
    historySummary,
  } = input;

  const isLeanPrompt = promptMode === 'lean';
  const isEfficientMode = enableAgentMode !== false && isLeanPrompt;

  // ============ tools bucket — real send pipeline, pure store reads ============
  const toolsEngine = createAgentToolsEngine(
    { model, provider },
    pluginIds,
    // Mirror the agent being rendered, not the active agent — in
    // group/supervisor sessions the two differ.
    undefined,
    agentId,
  );
  const { tools, enabledManifests } = toolsEngine.generateToolsDetailed({
    excludeDefaultToolIds: skillActivateMode === 'manual' ? manualModeExcludeToolIds : undefined,
    model,
    promptMode,
    provider,
    toolIds: pluginIds,
  });
  // Efficient mode defers long-tail plugins to <available_tools> instead of the
  // schema, and swaps teaching blocks for the compact policy — same rule as the
  // runtime tool composition.
  const deferredSet = isEfficientMode ? new Set(efficientDeferredPluginIds) : undefined;
  const isDeferred = (identifier: string) => !!deferredSet?.has(identifier);
  const countedTools = deferredSet
    ? tools?.filter((t) => !isDeferred((t.function?.name ?? '').split('____')[0]))
    : tools;
  const schemaNumber = countedTools?.map((i) => JSON.stringify(i)).join('') || '';

  const toolsSystemRole = isLeanPrompt
    ? LEAN_TOOL_USAGE_POLICY
    : enabledManifests.length > 0
      ? pluginPrompts({
          tools: enabledManifests.map((manifest) => ({
            apis: manifest.api.map((api) => ({
              desc: api.description,
              name: toolNameResolver.generate(manifest.identifier, api.name, manifest.type),
            })),
            identifier: manifest.identifier,
            name: pluginHelpers.getPluginTitle(manifest.meta) || manifest.identifier,
            systemRole: manifest.systemRole,
          })),
        })
      : '';

  // Skills index (<available_skills>) — same source as the send's skill context.
  const toolState = getToolStoreState();
  const skillItems = [...(toolState.builtinSkills || []), ...(toolState.agentSkills || [])]
    .filter((s) => s.description)
    .map((s) => ({
      description: s.description ?? '',
      identifier: s.identifier,
      name: s.name,
    }));
  const skillsText = skillsPrompts(skillItems, isLeanPrompt);

  // <available_tools> directory: not-yet-enabled tools plus deferred long-tail.
  const enabledToolIdsForDiscovery = new Set(countedTools?.map((t) => t.function?.name) ?? []);
  const discoveryTools = toolSelectors
    .availableToolsForDiscovery(toolState)
    .filter((tool) => !enabledToolIdsForDiscovery.has(tool.identifier));
  const toolsDirectoryText = availableToolsPrompts(discoveryTools, isEfficientMode);

  const toolsToken = count(toolsSystemRole + schemaNumber + skillsText + toolsDirectoryText);
  // ============ chats bucket — window messages + templated draft ============
  const messageText =
    messages
      ?.map((message) => (typeof message.content === 'string' ? message.content : ''))
      .join('') || '';
  const chatsToken = count(messageText) + count(draft);

  // ============ systemRole bucket ============
  const systemRoleToken = count(systemRole) + count(personaText);

  // ============ historySummary bucket ============
  const historySummaryToken = count(historySummary);

  return {
    chats: chatsToken,
    historySummary: historySummaryToken,
    systemRole: systemRoleToken,
    tools: toolsToken,
  };
};
