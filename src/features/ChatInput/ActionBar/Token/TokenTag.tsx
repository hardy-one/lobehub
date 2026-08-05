import { applyInputTemplate } from '@lobechat/context-engine';
import { resolveModelScopedChatConfig } from '@lobechat/types';
import { Center, Flexbox, Tooltip } from '@lobehub/ui';
import { TokenTag } from '@lobehub/ui/chat';
import { cssVar } from 'antd-style';
import numeral from 'numeral';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useModelContextWindowTokens } from '@/hooks/useModelContextWindowTokens';
import { useModelSupportToolUse } from '@/hooks/useModelSupportToolUse';
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
import { useToolStore } from '@/store/tool';
import { useUserStore } from '@/store/user';
import { settingsSelectors, userGeneralSettingsSelectors } from '@/store/user/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useEffectiveModel } from '../../hooks/useEffectiveModel';
import { useChatInputStore } from '../../store';
import ActionPopover from '../components/ActionPopover';
import TokenProgress from './TokenProgress';
import { countText, estimateTokenBreakdown, getToolContextRefreshKey } from './utils';

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
  const [systemRole, chatConfig, skillActivateMode, runtimeMode, hasEnabledKnowledgeBases] =
    useAgentStore((s) => {
      const config = chatConfigByIdSelectors.getChatConfigById(agentId)(s);
      return [
        agentByIdSelectors.getAgentSystemRoleById(agentId)(s),
        config,
        chatConfigByIdSelectors.getSkillActivateModeById(agentId)(s),
        chatConfigByIdSelectors.getRuntimeModeById(agentId)(s),
        agentByIdSelectors
          .getAgentKnowledgeBasesById(agentId)(s)
          .some((item) => item.enabled),
      ];
    });
  const pluginIds = useAgentStore((s) => agentByIdSelectors.getAgentPluginsById(agentId)(s));
  const globalMemoryEnabled = useUserStore(settingsSelectors.memoryEnabled);
  const memoryEnabled = chatConfig.memory?.enabled ?? globalMemoryEnabled;
  const [isProviderHasBuiltinSearch, isModelHasBuiltinSearch, isModelBuiltinSearchInternal] =
    useAiInfraStore((s) => [
      aiProviderSelectors.isProviderHasBuiltinSearch(provider)(s),
      aiModelSelectors.isModelHasBuiltinSearch(model, provider)(s),
      aiModelSelectors.isModelBuiltinSearchInternal(model, provider)(s),
    ]);
  // Model-scoped chat config (builtin search toggle can be model-specific).
  const modelChatConfig = resolveModelScopedChatConfig(chatConfig, provider, model);
  // Fingerprint of the tools bucket's implicit store inputs — recompute the
  // breakdown when any gate (KB/local-system/memory/search) changes.
  const toolContextRefreshKey = getToolContextRefreshKey({
    agentId,
    enableAgentMode: chatConfig.enableAgentMode,
    hasEnabledKnowledgeBases,
    isModelBuiltinSearchInternal,
    isModelHasBuiltinSearch,
    isProviderHasBuiltinSearch,
    memoryEnabled,
    runtimeMode,
    searchMode: chatConfig.searchMode,
    skillActivateMode,
    useModelBuiltinSearch: modelChatConfig.useModelBuiltinSearch,
  });
  // Subscribe to the tool store: skills / manifests load async after first
  // render, and the tools bucket must rebuild once they land.
  const toolStoreState = useToolStore();
  const maxTokens = useModelContextWindowTokens(model, provider);
  const isDevMode = useUserStore((s) => userGeneralSettingsSelectors.config(s).isDevMode);

  // Persona + topic memories — the same injection the real send embeds in the
  // system prompt. Memories load async (SWR) AFTER first render, so the memo
  // must subscribe to the userMemory store + active topic: previously it only
  // depended on promptMode and froze at the pre-hydration (empty) value,
  // silently dropping the whole persona from the estimate.
  const userMemoryState = useUserMemoryStore();
  const activeTopicId = useChatStore((s) => s.activeTopicId);
  const personaText = useMemo(() => {
    const personaMemories = combineUserMemoryData(resolveTopicMemories(), resolveUserPersona());
    return promptUserMemory({ memories: personaMemories }, chatConfig.promptMode === 'lean');
    // userMemoryState/activeTopicId feed the memo indirectly via the selectors.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTopicId, chatConfig.promptMode, userMemoryState]);

  // Buckets that do NOT change while typing: tools (real send generation),
  // systemRole, historySummary. Recomputed only when config/plugins/model
  // change — never per keystroke.
  /* eslint-disable react-hooks/exhaustive-deps */
  const staticBreakdown = useMemo(
    () =>
      estimateTokenBreakdown({
        agentId,
        model,
        provider,
        pluginIds,
        promptMode: chatConfig.promptMode,
        enableAgentMode: chatConfig.enableAgentMode,
        skillActivateMode,
        systemRole: systemRole ?? undefined,
        personaText,
        historySummary,
        messages: [],
      }),
    [
      agentId,
      chatConfig.enableAgentMode,
      chatConfig.promptMode,
      historySummary,
      model,
      personaText,
      pluginIds,
      provider,
      skillActivateMode,
      systemRole,
      toolContextRefreshKey,
      toolStoreState,
    ],
  );
  // eslint-enable react-hooks/exhaustive-deps

  const canUseTool = useModelSupportToolUse(model, provider);
  // Models without function calling ship no tools — the bucket must be zero,
  // mirroring the send path where the tools array is dropped.
  const toolsToken = canUseTool ? staticBreakdown.tools : 0;
  const systemRoleToken = staticBreakdown.systemRole;
  const historySummaryToken = staticBreakdown.historySummary;

  // Chats bucket: the display window (same truncation the send uses) plus the
  // templated draft. Cheap string counting — safe on every keystroke.
  const chatsToken = useMemo(() => {
    const messageText =
      contextWindowMessages
        ?.map((message) => (typeof message.content === 'string' ? message.content : ''))
        .join('') || '';
    const draftText = applyInputTemplate(input, chatConfig.inputTemplate);
    return countText(messageText) + countText(draftText);
  }, [chatConfig.inputTemplate, contextWindowMessages, input]);

  // Total token
  const totalToken = systemRoleToken + historySummaryToken + toolsToken + chatsToken;

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

Token.displayName = 'Token';

export default Token;
