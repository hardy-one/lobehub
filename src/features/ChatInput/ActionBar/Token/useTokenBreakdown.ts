import { LEAN_TOOL_USAGE_POLICY, ToolNameResolver } from '@lobechat/context-engine';
import { pluginPrompts, promptUserMemory, skillsPrompts } from '@lobechat/prompts';
import { resolveModelScopedChatConfig } from '@lobechat/types';
import { debounce } from 'es-toolkit/compat';
import { startTransition, useEffect, useMemo, useState } from 'react';

import { getTokenTagMode } from '@/helpers/tokenTagMode';
import { createAgentToolsEngine } from '@/helpers/toolEngineering';
import { useFetchTopicMemories } from '@/hooks/useFetchMemoryForTopic';
import { useModelContextWindowTokens } from '@/hooks/useModelContextWindowTokens';
import { useModelSupportToolUse } from '@/hooks/useModelSupportToolUse';
import { useTokenCount } from '@/hooks/useTokenCount';
import {
  combineUserMemoryData,
  resolveTopicMemories,
  resolveUserPersona,
} from '@/services/chat/mecha/memoryManager';
import { getAgentStoreState, useAgentStore } from '@/store/agent';
import {
  agentByIdSelectors,
  agentSelectors,
  chatConfigByIdSelectors,
} from '@/store/agent/selectors';
import { useAiInfraStore } from '@/store/aiInfra';
import { aiModelSelectors, aiProviderSelectors } from '@/store/aiInfra/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useToolStore } from '@/store/tool';
import { pluginHelpers } from '@/store/tool/helpers';
import { toolSelectors } from '@/store/tool/selectors';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useEffectiveModel } from '../../hooks/useEffectiveModel';
import { useStoreApi } from '../../store';
import {
  getToolContextRefreshKey,
  getToolExcludeDefaultToolIds,
  isContextTokensCurrent,
} from './utils';

const toolNameResolver = new ToolNameResolver();

type ChatInputStoreApi = ReturnType<typeof useStoreApi>;

interface ComposerSource {
  input: string;
  messages: string;
}

const readComposerSource = (storeApi: ChatInputStoreApi): ComposerSource => {
  const state = storeApi.getState();
  return {
    input: state.markdownContent || '',
    messages:
      state.contextWindowMessages
        ?.map((message) => (typeof message.content === 'string' ? message.content : ''))
        .join('') || '',
  };
};

// A render subscription to `markdownContent` would re-render the tag on every
// keystroke at urgent priority. Read the composer imperatively behind a
// debounce instead, and publish through a transition so token counting never
// competes with typing.
const useComposerSource = (): ComposerSource => {
  const storeApi = useStoreApi();
  const [source, setSource] = useState<ComposerSource>(() => readComposerSource(storeApi));

  useEffect(() => {
    const update = debounce(() => {
      const next = readComposerSource(storeApi);
      startTransition(() => {
        setSource((prev) =>
          prev.input === next.input && prev.messages === next.messages ? prev : next,
        );
      });
    }, 300);
    update();
    const unsubscribe = storeApi.subscribe(update);
    return () => {
      unsubscribe();
      update.cancel();
    };
  }, [storeApi]);

  return source;
};

export interface TokenBreakdown {
  chatsToken: number;
  historySummaryToken: number;
  maxTokens: number;
  systemRoleToken: number;
  toolsToken: number;
  totalToken: number;
}

export const useTokenBreakdown = (): TokenBreakdown => {
  const { input, messages } = useComposerSource();
  const historySummary = useChatStore(
    (s) => topicSelectors.currentActiveTopicSummary(s)?.content || '',
  );

  const agentId = useAgentId();
  const { model, provider } = useEffectiveModel(agentId);

  // Pre-send estimate data: agent documents and topic memories are fetched
  // lazily, fully async and fire-and-forget — nothing here ever blocks the
  // conversation (send / input). Both requests dedupe with the same SWR /
  // pending-request caches the send path uses, so they act as a warm-up:
  // by the time the user hits send the data is usually already cached.
  const activeTopicId = useChatStore((s) => s.activeTopicId);
  useEffect(() => {
    if (!agentId) return;
    void getAgentStoreState()
      .ensureAgentDocuments(agentId)
      .catch(() => {
        // Documents are optional on the client; a failed prefetch must not
        // surface as an unhandled rejection nor disturb the estimate.
      });
  }, [agentId]);
  useFetchTopicMemories(activeTopicId);
  const hasAgentDocuments = useAgentStore(
    (s) => (agentId ? agentSelectors.getAgentDocumentsById(agentId)(s)?.length : 0) > 0,
  );
  const [
    activeAgentId,
    systemRole,
    enableAgentMode,
    promptMode,
    searchMode,
    useModelBuiltinSearch,
    skillActivateMode,
    agentMemoryEnabled,
    runtimeMode,
    hasEnabledKnowledgeBases,
  ] = useAgentStore((s) => {
    const chatConfig = chatConfigByIdSelectors.getChatConfigById(agentId)(s);
    const modelChatConfig = resolveModelScopedChatConfig(chatConfig, provider, model);

    return [
      s.activeAgentId,
      agentByIdSelectors.getAgentSystemRoleById(agentId)(s),
      chatConfig.enableAgentMode,
      chatConfig.promptMode,
      chatConfig.searchMode,
      modelChatConfig.useModelBuiltinSearch,
      chatConfigByIdSelectors.getSkillActivateModeById(agentId)(s),
      chatConfig.memory?.enabled,
      chatConfigByIdSelectors.getRuntimeModeById(agentId)(s),
      agentByIdSelectors
        .getAgentKnowledgeBasesById(agentId)(s)
        .some((item) => item.enabled),
    ];
  });
  const globalMemoryEnabled = useUserStore(settingsSelectors.memoryEnabled);
  const effectiveMemoryEnabled = agentMemoryEnabled ?? globalMemoryEnabled;
  const [isProviderHasBuiltinSearch, isModelHasBuiltinSearch, isModelBuiltinSearchInternal] =
    useAiInfraStore((s) => [
      aiProviderSelectors.isProviderHasBuiltinSearch(provider)(s),
      aiModelSelectors.isModelHasBuiltinSearch(model, provider)(s),
      aiModelSelectors.isModelBuiltinSearchInternal(model, provider)(s),
    ]);
  const toolContextRefreshKey = getToolContextRefreshKey({
    agentId: activeAgentId || agentId,
    enableAgentMode,
    hasAgentDocuments,
    hasEnabledKnowledgeBases,
    isModelBuiltinSearchInternal,
    isModelHasBuiltinSearch,
    isProviderHasBuiltinSearch,
    memoryEnabled: effectiveMemoryEnabled,
    runtimeMode,
    searchMode,
    skillActivateMode,
    useModelBuiltinSearch,
  });

  const maxTokens = useModelContextWindowTokens(model, provider);

  const canUseTool = useModelSupportToolUse(model, provider);
  const pluginIds = useAgentStore((s) => agentByIdSelectors.getAgentPluginsById(agentId)(s));
  const installedPlugins = useToolStore((s) => s.installedPlugins);

  // Lean prompt (mirrors ToolSystemRoleProvider: promptMode==='lean' → compact
  // policy replaces the per-plugin teaching blocks).
  const isLeanPrompt = promptMode === 'lean';

  const toolsString = useMemo(() => {
    const toolsEngine = createAgentToolsEngine(
      { model, provider },
      pluginIds,
      // Mirror the agent being rendered, not the active agent — in
      // group/supervisor/page sessions the two differ and the breakdown
      // must follow the agent whose config this TokenTag reads.
      undefined,
      agentId,
      // Gateway-side toolset (agent documents) is included in the estimate
      // when the agent has documents — the server sends it, so the
      // pre-send breakdown should mirror it.
      { includeAgentDocuments: true },
    );

    const { tools, enabledManifests } = toolsEngine.generateToolsDetailed({
      excludeDefaultToolIds: getToolExcludeDefaultToolIds(skillActivateMode),
      model,
      provider,
      toolIds: pluginIds,
    });
    const schemaNumber = tools?.map((i) => JSON.stringify(i)).join('') || '';

    // Efficient mode: teaching blocks are replaced by the compact policy.
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

    // Skills index (<available_skills>) — mirrors SkillContextProvider using
    // the store's builtin + agent skills (sync, no content fetch).
    const toolState = useToolStore.getState();
    const skillItems = [...(toolState.builtinSkills || []), ...(toolState.agentSkills || [])]
      .filter((s) => s.description)
      .map((s) => ({
        description: s.description ?? '',
        identifier: s.identifier,
        name: s.name,
      }));
    const skillsText = skillsPrompts(skillItems);

    // Tool-discovery list (<available_tools>, lean mode only) — mirrors
    // AvailableToolsInjector using the same store data the activator lists,
    // with tools already enabled for this request excluded (the server sends
    // only activatable-but-not-enabled identifiers).
    const enabledToolIds = new Set(
      enabledManifests.map((manifest) => manifest.identifier).filter(Boolean),
    );
    const availableToolsText = isLeanPrompt
      ? toolSelectors
          .availableToolsForDiscovery(toolState)
          .filter((tool) => !enabledToolIds.has(tool.identifier))
          .map(
            (tool) =>
              `  <tool identifier="${tool.identifier}" name="${tool.name}">${tool.description}</tool>`,
          )
          .join('\n')
      : '';
    const availableToolsBlock = availableToolsText
      ? `<available_tools>\n${availableToolsText}\n</available_tools>`
      : '';

    return toolsSystemRole + schemaNumber + skillsText + availableToolsBlock;
    // installedPlugins + toolContextRefreshKey track the implicit
    // createAgentToolsEngine inputs read via getState() (tool manifests plus
    // agent/user/aiInfra config), so the engine only re-runs when they change
    // instead of on every render.
  }, [
    installedPlugins,
    model,
    pluginIds,
    promptMode,
    provider,
    skillActivateMode,
    toolContextRefreshKey,
  ]);

  // Estimated buckets — the fallback when the current topic has no recorded
  // send yet (new topic, first message still being typed).
  // Persona / user memory (<user_memory>) rides the tools bucket — the same
  // classification CONTEXT_BUCKET_RULES records on the send side.
  const personaMemories = combineUserMemoryData(resolveTopicMemories(), resolveUserPersona());
  const personaText = promptUserMemory({ memories: personaMemories });
  const estimatedTools = useTokenCount(personaText + (canUseTool ? toolsString : ''));

  const inputTokenCount = useTokenCount(input);
  const estimatedChats = useTokenCount(messages);

  // SystemRole token — the agent's system role text only; the injected
  // persona (user memory) is counted under tools.
  const estimatedSystemRole = useTokenCount(systemRole);
  const estimatedHistorySummary = useTokenCount(historySummary);

  // Exact send-side counts (tokenx, computed on the assembled payload).
  // When the current topic has never been sent — or the agent mode switched
  // since the last send (the recorded counts no longer describe the next
  // payload) — fall back to the estimates above; the gap is small there
  // because history/scenario injectors are absent until the first message
  // goes out.
  const [contextTokens] = useChatStore((s) => [s.contextTokens]);
  const currentMode = getTokenTagMode(enableAgentMode, promptMode);
  const currentTokens = isContextTokensCurrent(contextTokens, activeTopicId, currentMode)
    ? contextTokens
    : undefined;
  const systemRoleToken = currentTokens?.systemRole ?? estimatedSystemRole;
  const toolsToken = currentTokens?.tools ?? estimatedTools;
  const historySummaryToken = currentTokens?.historySummary ?? estimatedHistorySummary;
  // chats is always estimated from the live window (same tokenx estimator the
  // send-side count uses): the recorded chats bucket only covers the moment
  // of the last send, while assistant replies since then keep growing the
  // window — counting the window rows keeps the tag honest in between sends.
  const chatsToken = estimatedChats + inputTokenCount;

  const totalToken = systemRoleToken + historySummaryToken + toolsToken + chatsToken;

  return { chatsToken, historySummaryToken, maxTokens, systemRoleToken, toolsToken, totalToken };
};
