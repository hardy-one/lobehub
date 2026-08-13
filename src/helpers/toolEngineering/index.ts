/**
 * Tools Engineering - Unified tools processing using ToolsEngine
 */
import { AgentDocumentsManifest } from '@lobechat/builtin-tool-agent-documents';
import { AuvManifest } from '@lobechat/builtin-tool-auv';
import {
  createEnableChecker,
  type LobeToolManifest,
  type PluginEnableChecker,
} from '@lobechat/context-engine';
import { ToolsEngine } from '@lobechat/context-engine';
import { assembleManifestPool, resolveToolRules } from '@lobechat/mecha';
import {
  type BuiltinToolResolveContext,
  type ChatCompletionTool,
  type ToolManifest,
  type WorkingModel,
} from '@lobechat/types';
import { getActivePluginIds, getDisabledPluginIds } from '@lobechat/types';

import { applyToolNameMaxLength } from '@/helpers/applyToolNameMaxLength';
import { isToolAvailableInCurrentEnv } from '@/helpers/toolAvailability';
import { getAgentStoreState } from '@/store/agent';
import {
  agentByIdSelectors,
  agentChatConfigSelectors,

  agentSelectors,
  chatConfigByIdSelectors,
} from '@/store/agent/selectors';
import { aiModelSelectors, getAiInfraStoreState } from '@/store/aiInfra';
import { getToolStoreState } from '@/store/tool';
import {
  composioStoreSelectors,
  lobehubSkillStoreSelectors,
  pluginSelectors,
} from '@/store/tool/selectors';
import { connectorSelectors } from '@/store/tool/slices/connector';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

import { getSearchConfig } from '../getSearchConfig';
import { isCanUseFC } from '../isCanUseFC';
import { buildClientConnectorManifests } from './buildClientConnectorManifests';

/**
 * Tools engine configuration options
 */
export interface ToolsEngineConfig {
  /** Additional manifests to include beyond the standard ones */
  additionalManifests?: ToolManifest[];
  /** Default tool IDs that will always be added to the end of the tools list */
  defaultToolIds?: string[];
  /**
   * Identifiers the agent has explicitly disabled (`agents.plugins` tri-state).
   * Dropped from the combined manifest pool entirely — not just the
   * enableChecker rule map — because `allowExplicitActivation` lets the
   * activator resolve/enable any manifest present in `manifestSchemas`
   * regardless of the rules, bypassing a rule-only gate.
   */
  disabledPluginIds?: string[];
  /** Custom enable checker for plugins */
  enableChecker?: PluginEnableChecker;
  /**
   * Runtime context for context-aware builtin manifests. When provided, each
   * builtin tool with a `resolveManifest` produces its manifest for this context
   * (trimming APIs or opting out via `null`). Omit for context-free callers
   * (e.g. UI token estimation) — they get the full static manifests.
   */
  manifestContext?: BuiltinToolResolveContext;
}

/**
 * Initialize ToolsEngine with current manifest schemas and configurable options
 */
export const createToolsEngine = (config: ToolsEngineConfig = {}): ToolsEngine => {
  const {
    enableChecker,
    additionalManifests = [],
    defaultToolIds,
    disabledPluginIds = [],
    manifestContext,
  } = config;

  // Push the deployment's `TOOL_NAME_MAX_LENGTH` in before any tool name is
  // generated — the client mirror of `createServerToolsEngine`. Without it a
  // deployment setting `0` would still get `MD5HASH_…` names on this path.
  applyToolNameMaxLength();

  const toolStoreState = getToolStoreState();

  // Per-connector tool permissions, keyed by connector identifier: community-
  // MCP plugins execute outside the connector path, so the user's
  // needs_approval / disabled settings are patched onto their manifests.
  const connectorPermissions = new Map(
    connectorSelectors
      .connectorList(toolStoreState)
      .map((c) => [c.identifier, new Map(c.tools.map((t) => [t.toolName, t.permission]))] as const),
  );

  // The pool rules (connector precedence, permission patching, context-aware
  // builtins, invalid manifest guard, disabled-id exclusion) are shared with
  // the server; the browser only reads its stores.
  const { manifests } = assembleManifestPool(
    {
      additional: additionalManifests as LobeToolManifest[],
      builtinTools: toolStoreState.builtinTools,
      composio: composioStoreSelectors
        .composioAsLobeTools(toolStoreState)
        .map((tool) => tool.manifest as LobeToolManifest),
      connectors: buildClientConnectorManifests(
        connectorSelectors.customConnectors(toolStoreState),
      ) as LobeToolManifest[],
      installedPlugins: pluginSelectors.installedPluginManifestList(
        toolStoreState,
      ) as LobeToolManifest[],
      lobehubSkills: lobehubSkillStoreSelectors
        .lobehubSkillAsLobeTools(toolStoreState)
        .map((tool) => tool.manifest as LobeToolManifest),
    },
    {
      connectorPermissions,
      // Disabled identifiers leave the pool outright: explicit activation
      // bypasses the enable rules, so a rule-only gate would not hold.
      excludedIdentifiers: disabledPluginIds,
      manifestContext,
    },
  );

  // A plain Web client must not acquire the Electron IPC executor: Computer
  // Use only exists where the platform can run it.
  const allManifests = manifests.filter(
    (m) => m.identifier !== AuvManifest.identifier || isToolAvailableInCurrentEnv(m.identifier),
  );

  return new ToolsEngine({
    defaultToolIds,
    enableChecker,
    functionCallChecker: isCanUseFC,
    manifestSchemas: allManifests as ToolManifest[],
  });
};

export const createAgentToolsEngine = (
  workingModel: WorkingModel,
  /** Runtime-resolved plugin IDs (from agentConfigResolver), may include tools beyond the active agent */
  pluginIds?: string[],
  /** Conversation context for context-aware builtin manifests (scope, isSubAgent). */
  manifestContext?: BuiltinToolResolveContext,
  /**
   * Optional agentId override. When provided, the engine reads that agent's
   * config instead of the active agent — used by the TokenTag UI breakdown so
   * its tool-set mirrors the agent it renders for, even when the active agent
   * differs (group/supervisor/page sessions).
   */
  agentId?: string,
  /**
   * TokenTag-only estimation options. The agent-documents toolset is a
   * gateway-side builtin (the client has no executor for it), so it is
   * included in the UI estimate when the agent has documents — mirroring
   * what the server actually sends — but never in client sends.
   */
  estimateOptions?: { includeAgentDocuments?: boolean },
) => {
  const searchConfig = getSearchConfig(workingModel.model, workingModel.provider);
  const agentState = getAgentStoreState();
  // Every `currentXxx` selector is `xxxById(activeAgentId || '')` — resolve the
  // effective agent once so an explicit override and the active agent share one
  // code path. The override is used by the TokenTag UI breakdown so its tool-set
  // mirrors the agent it renders for (group/supervisor/page sessions).
  const effectiveAgentId = agentId ?? agentState.activeAgentId ?? '';
  const agentConfig = agentSelectors.getAgentConfigById(effectiveAgentId)(agentState);
  // `getActivePluginIds` already resolves to pinned-only identifiers — disabled
  // entries never reach the tools-engine whitelist.
  const userPlugins = getActivePluginIds(agentConfig?.plugins);
  const disabledPluginIds = getDisabledPluginIds(agentConfig?.plugins);
  const chatConfig = chatConfigByIdSelectors.getChatConfigById(effectiveAgentId)(agentState);

  // The rules — mode, per-tool enablement and defaults — are shared with the
  // server runtime through `@lobechat/mecha`; the browser only assembles its
  // facts. It has no device gateway, so no device walls apply here and the
  // remaining platform gate stays in `platformFilter` below.
  // `resolveToolRules` already implements the Agent/Efficient/Chat mode tiers
  // (toolMode, defaults, explicit activation) so the lean chat-mode whitelist
  // from the mode-tiers change is preserved through the shared rules.
  const resolved = resolveToolRules({
    agent: {
      chatConfig,
      plugins: userPlugins,
    },
    disabledPluginIds,
    executionTarget: chatConfigByIdSelectors.getExecutionTargetById(effectiveAgentId)(agentState),
    hasEnabledKnowledgeBases: agentByIdSelectors
      .getAgentKnowledgeBasesById(effectiveAgentId)(agentState)
      .some((item) => item.enabled),
    // A `local` target only resolves on the desktop, where the host itself is
    // the machine: local tools are always reachable there.
    localExecutionReady: true,
    memoryEnabled:
      chatConfig.memory?.enabled ?? settingsSelectors.memoryEnabled(useUserStore.getState()),
    model: {
      canUseFC: isCanUseFC(workingModel.model, workingModel.provider),
      hasImageOutput: aiModelSelectors.isModelSupportImageOutput(
        workingModel.model,
        workingModel.provider,
      )(getAiInfraStoreState()),
    },
    runtimePluginIds: pluginIds,
    useApplicationBuiltinSearchTool: searchConfig.useApplicationBuiltinSearchTool,
  });

  // The documents toolset is gateway-side. Keep it out of browser sends, but
  // add it to TokenTag estimates when the server will expose agent documents.
  // This preserves the TokenTag accounting intent on top of the shared rules.
  const includeAgentDocuments =
    resolved.toolMode === 'agent' &&
    estimateOptions?.includeAgentDocuments === true &&
    (agentSelectors.getAgentDocumentsById(effectiveAgentId)(agentState)?.length ?? 0) > 0;

  return createToolsEngine({
    defaultToolIds: resolved.defaultToolIds,
    disabledPluginIds: [...resolved.excludedIdentifiers],
    manifestContext,
    enableChecker: createEnableChecker({
      allowExplicitActivation: resolved.allowExplicitActivation,
      platformFilter: ({ pluginId }) => {
        const toolStoreState = getToolStoreState();
        const installedPlugin = pluginSelectors.getInstalledPluginById(pluginId)(toolStoreState);

        if (
          !isToolAvailableInCurrentEnv(pluginId, {
            installedPlugins: installedPlugin ? [installedPlugin] : toolStoreState.installedPlugins,
          })
        ) {
          return false;
        }

        return undefined; // fall through to rules
      },
      rules: includeAgentDocuments
        ? { ...resolved.rules, [AgentDocumentsManifest.identifier]: true }
        : resolved.rules,
    }),
    ...(includeAgentDocuments && { additionalManifests: [AgentDocumentsManifest] }),
  });
};

/**
 * Provides the same functionality using ToolsEngine with enhanced capabilities
 *
 * @param toolIds - Array of tool IDs to generate tools for
 * @param model - Model name for function calling compatibility check (optional)
 * @param provider - Provider name for function calling compatibility check (optional)
 * @returns Array of ChatCompletionTool objects
 */
export const getEnabledTools = (
  toolIds: string[] = [],
  model: string,
  provider: string,
): ChatCompletionTool[] => {
  const toolsEngine = createToolsEngine();

  return (
    toolsEngine.generateTools({
      model, // Use provided model or fallback
      provider, // Use provided provider or fallback
      toolIds,
    }) || []
  );
};
