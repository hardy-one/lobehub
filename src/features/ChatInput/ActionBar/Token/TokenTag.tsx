import { efficientDeferredPluginIds } from '@lobechat/builtin-tools';
import { LEAN_TOOL_USAGE_POLICY, ToolNameResolver } from '@lobechat/context-engine';
import {
  availableToolsPrompts,
  pluginPrompts,
  promptUserMemory,
  skillsPrompts,
} from '@lobechat/prompts';
import { resolveModelScopedChatConfig } from '@lobechat/types';
import { Center, Flexbox, Tooltip } from '@lobehub/ui';
import { TokenTag } from '@lobehub/ui/chat';
import { cssVar } from 'antd-style';
import numeral from 'numeral';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { createAgentToolsEngine } from '@/helpers/toolEngineering';
import { useModelContextWindowTokens } from '@/hooks/useModelContextWindowTokens';
import { useModelSupportToolUse } from '@/hooks/useModelSupportToolUse';
import { useTokenCount } from '@/hooks/useTokenCount';
import {
  combineUserMemoryData,
  resolveTopicMemories,
  resolveUserPersona,
} from '@/services/chat/mecha/memoryManager';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { useAiInfraStore } from '@/store/aiInfra';
import { aiModelSelectors, aiProviderSelectors } from '@/store/aiInfra/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { getToolStoreState, useToolStore } from '@/store/tool';
import { pluginHelpers } from '@/store/tool/helpers';
import { toolSelectors } from '@/store/tool/selectors';
import { useUserStore } from '@/store/user';
import { settingsSelectors, userGeneralSettingsSelectors } from '@/store/user/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useEffectiveModel } from '../../hooks/useEffectiveModel';
import { useChatInputStore } from '../../store';
import ActionPopover from '../components/ActionPopover';
import TokenProgress from './TokenProgress';
import { getToolContextRefreshKey, getToolExcludeDefaultToolIds } from './utils';

const toolNameResolver = new ToolNameResolver();

const Token = memo(() => {
  const { t } = useTranslation(['chat', 'components']);

  const [input, contextWindowMessages] = useChatInputStore((s) => [
    s.markdownContent,
    s.contextWindowMessages,
  ]);
  const historySummary = useChatStore(
    (s) => topicSelectors.currentActiveTopicSummary(s)?.content || '',
  );

  const agentId = useAgentId();
  const { model, provider } = useEffectiveModel(agentId);
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

  // Tool usage token
  const canUseTool = useModelSupportToolUse(model, provider);
  const pluginIds = useAgentStore((s) => agentByIdSelectors.getAgentPluginsById(agentId)(s));

  // Efficient mode (agent + lean): mirror the runtime — long-tail plugins
  // deferred to <available_tools> and teaching blocks replaced by the compact
  // policy, so the breakdown matches the real request instead of the legacy
  // full-prompt estimate.
  // Lean prompt (mirrors ToolSystemRoleProvider: promptMode==='lean' → compact
  // policy + persona regardless of agent/chat mode). Efficient mode additionally
  // defers long-tail plugins to <available_tools> (agent + lean only).
  const isLeanPrompt = promptMode === 'lean';
  const isEfficientMode = enableAgentMode !== false && isLeanPrompt;
  const toolsString = useToolStore(
    useCallback(() => {
      const toolsEngine = createAgentToolsEngine(
        { model, provider },
        pluginIds,
        // Mirror the agent being rendered, not the active agent — in
        // group/supervisor/page sessions the two differ and the breakdown
        // must follow the agent whose config this TokenTag reads.
        undefined,
        agentId,
      );

      const { tools, enabledManifests } = toolsEngine.generateToolsDetailed({
        excludeDefaultToolIds: getToolExcludeDefaultToolIds(skillActivateMode),
        model,
        promptMode,
        provider,
        toolIds: pluginIds,
      });
      // Efficient mode drops the deferred long-tail plugins from the schema count.
      const deferredSet = isEfficientMode ? new Set(efficientDeferredPluginIds) : undefined;
      const countedTools = deferredSet
        ? tools?.filter((t) => !deferredSet.has((t.function?.name ?? '').split('____')[0]))
        : tools;
      const schemaNumber = countedTools?.map((i) => JSON.stringify(i)).join('') || '';

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
      const toolState = getToolStoreState();
      const skillItems = [...(toolState.builtinSkills || []), ...(toolState.agentSkills || [])]
        .filter((s) => s.description)
        .map((s) => ({
          description: s.description ?? '',
          identifier: s.identifier,
          name: s.name,
        }));
      const skillsText = skillsPrompts(skillItems, isLeanPrompt);

      // <available_tools> directory: not-yet-enabled tools (full mode) plus the
      // deferred long-tail plugins (efficient mode).
      const enabledToolIdsForDiscovery = new Set(countedTools?.map((t) => t.function?.name) ?? []);
      const discoveryTools = toolSelectors
        .availableToolsForDiscovery(toolState)
        .filter((tool) => !enabledToolIdsForDiscovery.has(tool.identifier));
      const toolsDirectoryText = availableToolsPrompts(discoveryTools, isEfficientMode);

      return toolsSystemRole + schemaNumber + skillsText + toolsDirectoryText;
      // toolContextRefreshKey tracks implicit createAgentToolsEngine inputs from other stores.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [model, pluginIds, promptMode, provider, skillActivateMode, toolContextRefreshKey]),
  );

  const toolsToken = useTokenCount(canUseTool ? toolsString : '');

  // Chat usage token
  const inputTokenCount = useTokenCount(input);

  const messageString =
    contextWindowMessages
      ?.map((message) => (typeof message.content === 'string' ? message.content : ''))
      .join('') || '';
  const chatsToken = useTokenCount(messageString) + inputTokenCount;

  // SystemRole token — include the injected persona (user_memory) so the
  // breakdown matches the real request.
  const personaMemories = combineUserMemoryData(resolveTopicMemories(), resolveUserPersona());
  const personaText = promptUserMemory({ memories: personaMemories }, isLeanPrompt);
  const systemRoleToken = useTokenCount(systemRole + personaText);
  const historySummaryToken = useTokenCount(historySummary);

  // Total token
  const totalToken = systemRoleToken + historySummaryToken + toolsToken + chatsToken;

  const isDevMode = useUserStore((s) => userGeneralSettingsSelectors.config(s).isDevMode);

  // Keep the composer quiet for regular users until context pressure is real;
  // dev mode always shows the tag for inspection.
  if (!isDevMode && maxTokens > 0 && totalToken / maxTokens <= 0.5) return null;

  const content = (
    <Flexbox gap={12} style={{ minWidth: 200 }}>
      <Flexbox horizontal align={'center'} gap={4} justify={'space-between'} width={'100%'}>
        <div style={{ color: cssVar.colorTextDescription }}>{t('tokenDetails.title')}</div>
        <Tooltip
          styles={{ root: { maxWidth: 'unset', pointerEvents: 'none' } }}
          title={t('ModelSelect.featureTag.tokens', {
            ns: 'components',
            tokens: numeral(maxTokens).format('0,0'),
          })}
        >
          <Center
            height={20}
            paddingInline={4}
            style={{
              background: cssVar.colorFillTertiary,
              borderRadius: 4,
              color: cssVar.colorTextSecondary,
              fontFamily: cssVar.fontFamilyCode,
              fontSize: 11,
            }}
          >
            TOKEN
          </Center>
        </Tooltip>
      </Flexbox>
      {isDevMode && (
        <TokenProgress
          showIcon
          data={[
            {
              color: cssVar.magenta,
              id: 'systemRole',
              title: t('tokenDetails.systemRole'),
              value: systemRoleToken,
            },
            {
              color: cssVar.geekblue,
              id: 'tools',
              title: t('tokenDetails.tools'),
              value: toolsToken,
            },
            {
              color: cssVar.orange,
              id: 'historySummary',
              title: t('tokenDetails.historySummary'),
              value: historySummaryToken,
            },
            {
              color: cssVar.gold,
              id: 'chats',
              title: t('tokenDetails.chats'),
              value: chatsToken,
            },
          ]}
        />
      )}
      <TokenProgress
        showIcon={isDevMode}
        showTotal={t('tokenDetails.total')}
        data={[
          {
            color: cssVar.colorSuccess,
            id: 'used',
            title: t('tokenDetails.used'),
            value: totalToken,
          },
          {
            color: cssVar.colorFill,
            id: 'rest',
            title: t('tokenDetails.rest'),
            value: maxTokens - totalToken,
          },
        ]}
      />
    </Flexbox>
  );

  return (
    <ActionPopover content={content}>
      <TokenTag
        maxValue={maxTokens}
        mode={'used'}
        value={totalToken}
        size={{
          blockSize: 28,
          size: 18,
        }}
        text={{
          overload: t('tokenTag.overload'),
          remained: t('tokenTag.remained'),
          used: t('tokenTag.used'),
        }}
      />
    </ActionPopover>
  );
});

export default Token;
