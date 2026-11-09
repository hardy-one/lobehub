import { Flexbox, Icon, Popover, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  ChevronDownIcon,
  FolderIcon,
  InfinityIcon,
  MessageCircleIcon,
  SearchIcon,
  TerminalIcon,
  WrenchIcon,
  ZapIcon,
} from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useBusinessAgentModeSync } from '@/business/client/hooks/useBusinessAgentMode';
import { SkeletonBar } from '@/components/Skeleton';
import { useAgentId } from '@/features/ChatInput/hooks/useAgentId';
import { useChatInputResourceAccess } from '@/features/ChatInput/hooks/useChatInputResourceAccess';
import {
  type ChatInputMode,
  useEffectiveAgentMode,
} from '@/features/ChatInput/hooks/useEffectiveAgentMode';
import { useToggleAgentMode } from '@/features/ChatInput/hooks/useToggleAgentMode';
import { usePermission } from '@/hooks/usePermission';

const styles = stylex.create({
  activeOption: { backgroundColor: cssVar.colorFillSecondary, backgroundImage: 'none' },
  // Keeps the selected row's resting fill while cancelling the hover highlight.
  activeOptionDisabled: {
    backgroundColor: { 'default': cssVar.colorFillSecondary, ':hover': 'transparent' },
    backgroundImage: 'none',
  },
  agentTooltip: { display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '160px' },
  agentTooltipCap: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
  },
  agentTooltipTitle: {
    marginBlockEnd: '2px',
    fontSize: '12px',
    fontWeight: 600,
    color: cssVar.colorText,
  },
  button: {
    cursor: 'pointer',
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    height: '28px',
    paddingInline: '8px',
    borderRadius: '999px',
    fontSize: '12px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    backgroundColor: { 'default': cssVar.colorFillTertiary, ':hover': cssVar.colorFillSecondary },
    backgroundImage: 'none',
    // Only paint the two properties that actually change: transitioning `all`
    // also animates the layout of the third (on-demand) row on mode switches.
    transition: 'color 0.2s, background-color 0.2s',
  },
  buttonDisabled: {
    cursor: 'not-allowed',
    opacity: 0.5,
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorTextSecondary },
    backgroundColor: { 'default': cssVar.colorFillTertiary, ':hover': cssVar.colorFillTertiary },
  },
  option: {
    cursor: 'pointer',
    width: '100%',
    // Three rows instead of two: keep the taller menu compact.
    paddingBlock: '8px',
    paddingInline: '8px',
    borderRadius: cssVar.borderRadius,
    transition: 'background-color 0.2s',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillSecondary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  optionDisabled: {
    cursor: 'not-allowed',
    opacity: 0.55,
    backgroundColor: { 'default': null, ':hover': 'transparent' },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  optionDesc: {
    fontSize: '12px',
    lineHeight: 1.4,
    color: cssVar.colorTextDescription,
  },
  optionIcon: {
    flexShrink: 0,
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
  },
  optionTitle: {
    fontSize: '14px',
    fontWeight: 500,
    lineHeight: 1.4,
    color: cssVar.colorText,
  },
  // The popup pads its option rows by 4px, so its corner must be one step larger
  // than the rows' radius (borderRadius 8 → borderRadiusLG 12 = 8 + 4) to wrap them
  // concentrically instead of looking tighter than them. StyleX is unlayered, so it
  // outranks the base popup style's border-radius without the `&&&` hack.
  popoverPopup: { borderRadius: cssVar.borderRadiusLG },
});

const AGENT_CAPS = [
  { icon: WrenchIcon, key: 'tools' },
  { icon: SearchIcon, key: 'web' },
  { icon: FolderIcon, key: 'files' },
  { icon: TerminalIcon, key: 'env' },
] as const;

const MODE_COPY = {
  'agent': { description: 'chatMode.agentDesc', label: 'chatMode.agent' },
  'chat': { description: 'chatMode.chatDesc', label: 'chatMode.chat' },
  'on-demand': { description: 'chatMode.onDemandDesc', label: 'chatMode.onDemand' },
} as const satisfies Record<ChatInputMode, { description: string; label: string }>;

const AgentMode = memo(() => {
  const { t } = useTranslation('chat');
  const agentId = useAgentId();
  const toggleAgentMode = useToggleAgentMode();
  useBusinessAgentModeSync(agentId);
  const [open, setOpen] = useState(false);
  const { allowed: canCreateContent, reason } = usePermission('create_content');
  const { canUseResource, isAccessLoading, isGroupContext } = useChatInputResourceAccess();

  const {
    canSelectAgentMode,
    canSelectOnDemandMode,
    currentMode,
    isAgentModeUnavailable,
    isPreferenceLoading,
  } = useEffectiveAgentMode(agentId);
  const disabled = !canCreateContent || !canUseResource;
  const disabledReason = !canCreateContent
    ? reason
    : t(isGroupContext ? 'input.viewOnlyGroup' : 'input.viewOnlyAgent');
  const MODE_ICONS: Record<ChatInputMode, typeof InfinityIcon> = {
    'agent': InfinityIcon,
    'chat': MessageCircleIcon,
    'on-demand': ZapIcon,
  };
  const CurrentIcon = MODE_ICONS[currentMode];

  const handleSelect = useCallback(
    async (mode: ChatInputMode) => {
      if (disabled) return;
      if (mode === 'agent' && !canSelectAgentMode) return;
      if (mode === 'on-demand' && !canSelectOnDemandMode) return;

      setOpen(false);
      await toggleAgentMode(mode);
    },
    [canSelectAgentMode, canSelectOnDemandMode, disabled, toggleAgentMode],
  );

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (disabled) return;

      setOpen(nextOpen);
    },
    [disabled],
  );

  const agentTooltip = (
    <div {...stylex.props(styles.agentTooltip)}>
      <div {...stylex.props(styles.agentTooltipTitle)}>{t('chatMode.agent')}</div>
      {AGENT_CAPS.map(({ key, icon }) => (
        <div {...stylex.props(styles.agentTooltipCap)} key={key}>
          <Icon icon={icon} size={12} />
          {t(`chatMode.agentCap.${key}`)}
        </div>
      ))}
    </div>
  );

  const chatTooltip = t('chatMode.chatDesc');
  const buttonTooltip = isAgentModeUnavailable
    ? t('chatMode.agentUnsupported')
    : currentMode === 'on-demand'
      ? t('chatMode.onDemandDesc')
      : currentMode === 'agent'
        ? agentTooltip
        : chatTooltip;
  const MODE_OPTIONS: Array<{
    disabled?: boolean;
    icon: typeof InfinityIcon;
    key: ChatInputMode;
  }> = [
    { disabled: !canSelectAgentMode, icon: InfinityIcon, key: 'agent' },
    { icon: MessageCircleIcon, key: 'chat' },
    { disabled: !canSelectOnDemandMode, icon: ZapIcon, key: 'on-demand' },
  ];

  const popoverContent = (
    <Flexbox gap={4} style={{ maxWidth: 320, minWidth: 280 }}>
      {MODE_OPTIONS.map(({ disabled: optionDisabled, icon: OptionIcon, key }) => (
        <Flexbox
          horizontal
          align="center"
          aria-disabled={optionDisabled || undefined}
          gap={12}
          key={key}
          className={
            stylex.props(
              styles.option,
              currentMode === key && styles.activeOption,
              optionDisabled && styles.optionDisabled,
              currentMode === key && optionDisabled && styles.activeOptionDisabled,
            ).className
          }
          onClick={() => handleSelect(key)}
        >
          <Flexbox
            align="center"
            className={stylex.props(styles.optionIcon).className}
            height={32}
            justify="center"
            width={32}
          >
            <Icon icon={OptionIcon} size={16} />
          </Flexbox>
          <Flexbox flex={1}>
            <div {...stylex.props(styles.optionTitle)}>{t(MODE_COPY[key].label)}</div>
            <div {...stylex.props(styles.optionDesc)}>
              {t(
                optionDisabled && !canSelectAgentMode
                  ? 'chatMode.agentUnsupported'
                  : MODE_COPY[key].description,
              )}
            </div>
          </Flexbox>
        </Flexbox>
      ))}
    </Flexbox>
  );

  const button = (
    <div {...stylex.props(styles.button, disabled && styles.buttonDisabled)}>
      <Icon icon={CurrentIcon} size={14} />
      <span>{t(MODE_COPY[currentMode].label)}</span>
      <Icon icon={ChevronDownIcon} size={12} />
    </div>
  );

  // Hold the 28px pill's footprint so the action bar does not shift when it resolves.
  if (isAccessLoading || isPreferenceLoading)
    return <SkeletonBar height={28} radius={999} width={84} />;

  if (disabled)
    return (
      <Tooltip title={disabledReason}>
        <div>{button}</div>
      </Tooltip>
    );

  return (
    <Popover
      className={stylex.props(styles.popoverPopup).className}
      content={popoverContent}
      open={!disabled && open}
      placement="bottomLeft"
      trigger="click"
      styles={{
        // Match the inner viewport's corner to the enlarged popup radius so its
        // border corners don't poke through the rounded popup.
        content: {
          border: `1px solid ${cssVar.colorBorderSecondary}`,
          borderRadius: cssVar.borderRadiusLG,
          padding: 4,
        },
      }}
      onOpenChange={handleOpenChange}
    >
      <div>{open ? button : <Tooltip title={buttonTooltip}>{button}</Tooltip>}</div>
    </Popover>
  );
});

AgentMode.displayName = 'AgentMode';

export default AgentMode;
