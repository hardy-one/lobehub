import { applyInputTemplate, readStoredContext } from '@lobechat/context-engine';
import { promptUserMemory } from '@lobechat/prompts';
import { resolveModelScopedChatConfig } from '@lobechat/types';
import { Center, Flexbox, Tooltip } from '@lobehub/ui';
import { TokenTag } from '@lobehub/ui/chat';
import { cssVar } from 'antd-style';
import numeral from 'numeral';
import { memo, useEffect, useMemo, useState } from 'react';
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
import { useUserMemoryStore } from '@/store/userMemory';

import { useAgentId } from '../../hooks/useAgentId';
import { useEffectiveModel } from '../../hooks/useEffectiveModel';
import { useChatInputStore } from '../../store';
import ActionPopover from '../components/ActionPopover';
import TokenProgress from './TokenProgress';
import {
  countText,
  estimateContextDelta,
  estimateContextTotal,
  estimateTokenBreakdown,
  getToolContextRefreshKey,
  scaleBreakdown,
} from './utils';

const useDebouncedValue = <T,>(value: T, delay = 300): T => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
};

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
  // system prompt. Subscribe to the userMemory store directly (standard
  // useUserMemoryStore hook — the same pattern every other consumer uses), so
  // async-loaded memories trigger a recompute exactly when they land, without
  // re-running on every keystroke.
  const userMemoryState = useUserMemoryStore();
  const personaText = useMemo(() => {
    const personaMemories = combineUserMemoryData(resolveTopicMemories(), resolveUserPersona());
    return promptUserMemory({ memories: personaMemories }, chatConfig.promptMode === 'lean');
    // userMemoryState feeds the memo indirectly via the memory selectors.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatConfig.promptMode, userMemoryState]);

  // Tools bucket — the expensive part (real send generation). Recomputed only
  // when the tool set inputs change (config/plugins/model/gates/tool store);
  // persona/systemRole/historySummary are deliberately NOT inputs (they only
  // feed the cheap per-render buckets below) so typing never rebuilds tools.
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
        messages: [],
      }),
    [
      agentId,
      chatConfig.enableAgentMode,
      chatConfig.promptMode,
      model,
      pluginIds,
      provider,
      skillActivateMode,
      toolContextRefreshKey,
      toolStoreState,
    ],
  );
  // eslint-enable react-hooks/exhaustive-deps

  const canUseTool = useModelSupportToolUse(model, provider);
  // Models without function calling ship no tools — the bucket must be zero,
  // mirroring the send path where the tools array is dropped.
  const toolsToken = canUseTool ? staticBreakdown.tools : 0;
  // Cheap buckets — memoized: systemRole/persona/historySummary change rarely
  // (config/memories), so caching skips the tokenx estimation on every
  // stream-chunk re-render (upstream debounces the same inputs).
  const systemRoleToken = useMemo(
    () => countText(systemRole ?? undefined) + countText(personaText),
    [personaText, systemRole],
  );
  const historySummaryToken = useMemo(() => countText(historySummary), [historySummary]);

  // Templated draft (already applied to the input) — counted in chats and
  // reused as the incremental draft term of the baseline estimate.
  const draftText = useMemo(
    () => applyInputTemplate(input, chatConfig.inputTemplate),
    [chatConfig.inputTemplate, input],
  );
  // Debounce the per-keystroke / per-stream-chunk inputs: the window messages
  // mutate on every streaming chunk, and re-running the full-window token
  // estimate synchronously each chunk would stall the stream. The displayed
  // chats/contextTotal refresh at most every 300ms (same cadence upstream's
  // useTokenCount uses). The tools bucket is unaffected (it doesn't depend on
  // messages at all).
  const debouncedWindowMessages = useDebouncedValue(contextWindowMessages, 300);
  const debouncedDraftText = useDebouncedValue(draftText, 300);
  const chatsToken = useMemo(() => {
    const messageText =
      debouncedWindowMessages
        ?.map((message) => (typeof message.content === 'string' ? message.content : ''))
        .join('') || '';
    return countText(messageText) + countText(debouncedDraftText);
  }, [debouncedDraftText, debouncedWindowMessages]);

  // Real context baseline from the last completed request on this topic
  // (topic.metadata.contextTokens — same data the compression path persists).
  // No signature check: under the agent gateway the send runs server-side and
  // persists a signature over the SERVER's agent config, which the client
  // store cannot reproduce — a client-side check would reject every baseline.
  // The anchor check below still guards staleness (deleted/compressed
  // messages invalidate it), and the compression path keeps its own strict
  // signature validation server-side.
  const topicMetadata = useChatStore((s) => topicSelectors.currentActiveTopic(s)?.metadata);
  const storedContext = useMemo(() => readStoredContext(topicMetadata), [topicMetadata]);
  // TEMP-DEBUG: dump the baseline chain for probe validation (remove after fix)
  // eslint-disable-next-line no-console
  console.log('[TokenTag-debug] metadata:', {
    contextTokens: topicMetadata?.contextTokens ?? null,
    topicId: topicSelectors.currentActiveTopic(useChatStore.getState())?.id,
  });
  // eslint-disable-next-line no-console
  console.log('[TokenTag-debug] storedContext:', storedContext ?? null);

  // Estimated buckets (same estimator the compression path uses for messages).
  const estimatedTotal = systemRoleToken + historySummaryToken + toolsToken + chatsToken;
  // Real total when a usable baseline exists: stored tokens + estimate of
  // messages added since + the in-progress draft. Falls back to the pure
  // estimate (first turn / anchor gone / config changed).
  const contextTotal = useMemo(
    () =>
      estimateContextTotal({
        draft: debouncedDraftText,
        messages: debouncedWindowMessages ?? [],
        storedContext,
      }),
    [debouncedDraftText, debouncedWindowMessages, storedContext],
  );
  const totalToken = contextTotal ?? estimatedTotal;
  // Real breakdown persisted by the send side (measured buckets of the last
  // completed request). When present, display the real buckets + the
  // post-anchor delta (new messages + draft land in chats) — no scaling. The
  // estimated-bucket scale path only covers older baselines without one.
  // The anchor must still be present for the breakdown path (same freshness
  // gate as `estimateContextTotal`) — a compressed/deleted anchor means the
  // stored baseline no longer describes the window, so fall back to the
  // estimate path.
  const hasRealBreakdown =
    contextTotal !== undefined &&
    !!storedContext?.breakdown &&
    Object.keys(storedContext.breakdown).length > 0;
  // TEMP-DEBUG: which display path is taken (remove after fix)
  // eslint-disable-next-line no-console
  console.log('[TokenTag-debug] path:', {
    contextTotal,
    hasRealBreakdown,
    estimatedTotal,
    windowMessages: debouncedWindowMessages?.length ?? 0,
    anchorLastMsgId: storedContext?.lastMsgId ?? null,
  });
  const contextDelta = useMemo(
    () =>
      estimateContextDelta({
        draft: debouncedDraftText,
        messages: debouncedWindowMessages ?? [],
        storedContext,
      }),
    [debouncedDraftText, debouncedWindowMessages, storedContext],
  );
  const displayBreakdown = useMemo(() => {
    if (hasRealBreakdown && storedContext?.breakdown) {
      // Measured buckets: tokenx over the exact sent payload (persisted by
      // the send side) + the post-anchor delta. These match what tokenx
      // yields for the probe-captured payload — no calibration to the
      // provider-measured total, which counts with a different tokenizer
      // and would drift the buckets away from the probe.
      const b = storedContext.breakdown;
      return {
        chats: (b.chats ?? 0) + contextDelta,
        historySummary: b.historySummary ?? 0,
        systemRole: b.systemRole ?? 0,
        tools: b.tools ?? 0,
      };
    }
    return scaleBreakdown(
      {
        chats: chatsToken,
        historySummary: historySummaryToken,
        systemRole: systemRoleToken,
        tools: toolsToken,
      },
      totalToken,
    );
  }, [
    chatsToken,
    contextDelta,
    hasRealBreakdown,
    historySummaryToken,
    storedContext,
    systemRoleToken,
    toolsToken,
    totalToken,
  ]);
  // Displayed total = the tokenx bucket sum (same estimator and inputs as
  // the probe comparison) so TokenTag matches the captured payload exactly.
  // The provider-measured baseline stays the compression path's input.
  const displayTotal = hasRealBreakdown
    ? displayBreakdown.chats +
      displayBreakdown.historySummary +
      displayBreakdown.systemRole +
      displayBreakdown.tools
    : totalToken;
  if (!isDevMode && maxTokens > 0 && displayTotal / maxTokens <= 0.5) return null;

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
              value: displayBreakdown.systemRole,
            },
            {
              color: cssVar.geekblue,
              id: 'tools',
              title: t('tokenDetails.tools'),
              value: displayBreakdown.tools,
            },
            {
              color: cssVar.orange,
              id: 'historySummary',
              title: t('tokenDetails.historySummary'),
              value: displayBreakdown.historySummary,
            },
            {
              color: cssVar.gold,
              id: 'chats',
              title: t('tokenDetails.chats'),
              value: displayBreakdown.chats,
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
            value: displayTotal,
          },
          {
            color: cssVar.colorFill,
            id: 'rest',
            title: t('tokenDetails.rest'),
            value: maxTokens - displayTotal,
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
        value={displayTotal}
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
