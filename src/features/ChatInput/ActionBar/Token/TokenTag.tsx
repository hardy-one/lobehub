import { applyInputTemplate } from '@lobechat/context-engine';
import { promptUserMemory } from '@lobechat/prompts';
import { Center, Flexbox, Tooltip } from '@lobehub/ui';
import { TokenTag } from '@lobehub/ui/chat';
import { cssVar } from 'antd-style';
import numeral from 'numeral';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useModelContextWindowTokens } from '@/hooks/useModelContextWindowTokens';
import {
  combineUserMemoryData,
  resolveTopicMemories,
  resolveUserPersona,
} from '@/services/chat/mecha/memoryManager';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useEffectiveModel } from '../../hooks/useEffectiveModel';
import { useChatInputStore } from '../../store';
import ActionPopover from '../components/ActionPopover';
import TokenProgress from './TokenProgress';
import { countText, estimateTokenBreakdown } from './utils';

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
  const [systemRole, chatConfig, skillActivateMode] = useAgentStore((s) => {
    const config = chatConfigByIdSelectors.getChatConfigById(agentId)(s);
    return [
      agentByIdSelectors.getAgentSystemRoleById(agentId)(s),
      config,
      chatConfigByIdSelectors.getSkillActivateModeById(agentId)(s),
    ];
  });
  const pluginIds = useAgentStore((s) => agentByIdSelectors.getAgentPluginsById(agentId)(s));

  const maxTokens = useModelContextWindowTokens(model, provider);
  const isDevMode = useUserStore((s) => userGeneralSettingsSelectors.config(s).isDevMode);

  // Persona + topic memories — the same injection the real send embeds in the
  // system prompt (baseline behavior kept).
  const personaText = useMemo(() => {
    const personaMemories = combineUserMemoryData(resolveTopicMemories(), resolveUserPersona());
    return promptUserMemory({ memories: personaMemories }, chatConfig.promptMode === 'lean');
  }, [chatConfig.promptMode]);

  // Buckets that do NOT change while typing: tools (real send generation),
  // systemRole, historySummary. Recomputed only when config/plugins/model
  // change — never per keystroke.
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
    ],
  );

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

  const systemRoleToken = staticBreakdown.systemRole;
  const toolsToken = staticBreakdown.tools;
  const historySummaryToken = staticBreakdown.historySummary;

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
