'use client';

import { validateVideoFileSize } from '@lobechat/utils/client';
import { Icon } from '@lobehub/ui';
import { toast } from '@lobehub/ui/base-ui';
import { Upload } from 'antd';
import { cssVar } from 'antd-style';
import dayjs from 'dayjs';
import {
  CalendarClockIcon,
  CheckIcon,
  ChevronRight,
  FileUp,
  PlusIcon,
  TargetIcon,
  TypeIcon,
} from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type ActionDropdownMenuItems } from '@/features/ChatInput/ActionBar/components/ActionDropdown';
import { ChatInputAction } from '@/features/ChatInput/ActionBar/components/ChatInputAction';
import { useAgentId } from '@/features/ChatInput/hooks/useAgentId';
import { insertGoalTag } from '@/features/ChatInput/InputEditor/ActionTag/goalTag';
import { useChatInputStore } from '@/features/ChatInput/store';
import { useConversationStore } from '@/features/Conversation';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useFileStore } from '@/store/file';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import { OFFSETS_IN_HOURS, resolveScheduleTime } from './scheduleTime';

/**
 * The hetero action bar's `+` menu.
 *
 * Includes file attachments, formatting toolbar, and "Send later". The agent Plus
 * is not reused — most of it (web search, skills, gateway mode) has no meaning
 * for a CLI agent, and a menu of mostly-inapplicable rows is worse than a small one.
 *
 * Picking a time here only *arms* the send (`scheduledSendAt`); it creates
 * nothing. The send button remains the single commit action, and the armed state
 * is shown next to it by `ScheduledSendChip`.
 */
const HeteroPlus = memo(() => {
  const { t } = useTranslation('chat');
  const { t: tEditor } = useTranslation('editor');
  const [open, setOpen] = useState(false);

  const isMobile = useIsMobile();
  const agentId = useAgentId();
  const upload = useFileStore((s) => s.uploadChatFiles);
  const [editor, showTypoBar, setShowTypoBar] = useChatInputStore((s) => [
    s.editor,
    s.showTypoBar,
    s.setShowTypoBar,
  ]);

  const attachmentItem = useMemo(() => {
    const handleUpload = async (file: File) => {
      const validation = validateVideoFileSize(file);
      if (!validation.isValid) {
        toast.error(
          t('upload.validation.videoSizeExceeded', {
            actualSize: validation.actualSize,
            maxSize: validation.maxSize,
          }),
        );
        return false;
      }

      setOpen(false);
      editor?.focus();
      await upload([file], agentId);

      return false;
    };

    return {
      closeOnClick: false,
      icon: FileUp,
      key: 'upload-attachment',
      label: (
        <Upload multiple beforeUpload={handleUpload} showUploadList={false}>
          <span style={{ display: 'block', width: '100%' }}>
            {t('upload.action.fileOrImageUpload')}
          </span>
        </Upload>
      ),
    } as ActionDropdownMenuItems[number];
  }, [agentId, editor, t, upload]);

  const scheduledSendAt = useConversationStore((s) => s.scheduledSendAt);
  const setScheduledSendAt = useConversationStore((s) => s.setScheduledSendAt);
  const enableTopicAcceptance = useUserStore(labPreferSelectors.enableTopicAcceptance);

  const armSchedule = useCallback(
    (hours: number) => {
      setScheduledSendAt(resolveScheduleTime(hours).toISOString());
      setOpen(false);
    },
    [setScheduledSendAt],
  );

  const items: ActionDropdownMenuItems = useMemo(() => {
    // Which row is armed: compare against the same on-the-hour slot each row
    // would produce, so the check mark tracks the row the user actually picked.
    const armedHours = scheduledSendAt
      ? OFFSETS_IN_HOURS.find((hours) =>
          resolveScheduleTime(hours).isSame(dayjs(scheduledSendAt), 'minute'),
        )
      : undefined;

    return [
      attachmentItem,
      { type: 'divider' },
      {
        children: OFFSETS_IN_HOURS.map((hours) => ({
          extra:
            armedHours === hours ? (
              <Icon icon={CheckIcon} size={16} style={{ color: cssVar.colorSuccess }} />
            ) : (
              <span style={{ color: cssVar.colorTextTertiary, fontSize: 12 }}>
                {resolveScheduleTime(hours).format('MM-DD HH:mm')}
              </span>
            ),
          key: `scheduleSend-${hours}h`,
          label: t('input.schedule.inHours', { count: hours }),
          onClick: () => armSchedule(hours),
        })),
        // Trailing chevron (replaces base-ui's default triangle submenu arrow,
        // which ActionDropdown hides via the .lobe-submenu-chevron rule).
        extra: <Icon className="lobe-submenu-chevron" icon={ChevronRight} size={16} />,
        icon: CalendarClockIcon,
        key: 'scheduleSend',
        label: t('input.schedule.title'),
      },
      { type: 'divider' },
      // Formatting toolbar toggle — same trailing-switch row as the agent Plus.
      {
        checked: Boolean(showTypoBar),
        icon: TypeIcon,
        key: 'typo',
        label: tEditor('actions.typobar.title'),
        onCheckedChange: (checked: boolean) => setShowTypoBar(checked),
        type: 'switch',
      },
      // Goal creation shares the standard input's goal chip.
      ...(enableTopicAcceptance
        ? ([
            { type: 'divider' },
            {
              icon: TargetIcon,
              key: 'set-topic-goal',
              // Same string as the chip it inserts — see the agent composer's Plus.
              label: tEditor('slash.goal'),
              onClick: () => {
                setOpen(false);
                insertGoalTag(editor, tEditor('slash.goal'));
              },
            },
          ] as ActionDropdownMenuItems)
        : []),
    ];
  }, [
    attachmentItem,
    t,
    tEditor,
    showTypoBar,
    setShowTypoBar,
    armSchedule,
    scheduledSendAt,
    enableTopicAcceptance,
    editor,
  ]);

  return (
    <ChatInputAction
      icon={PlusIcon}
      open={open}
      size={{ blockSize: 32, borderRadius: 16, size: 18 }}
      // The menu includes attachments, formatting, and scheduling actions.
      title={t('input.heteroPlus.tooltip')}
      tooltipProps={{ placement: 'top' }}
      dropdown={{
        menu: { items },
        minWidth: 220,
        popupProps: isMobile
          ? {
              style: {
                maxWidth: 'calc(100vw - 32px)',
                minWidth: 0,
                width: 'min(320px, calc(100vw - 32px))',
              },
            }
          : undefined,
        placement: 'topLeft',
      }}
      onOpenChange={setOpen}
    />
  );
});

HeteroPlus.displayName = 'HeteroPlus';

export default HeteroPlus;
