import { KeyEnum } from '@lobechat/const/hotkeys';
import { combineKeys, Flexbox, Hotkey } from '@lobehub/ui';
import { memo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { useAgentId } from '@/features/ChatInput/hooks/useAgentId';
import { useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { preferenceSelectors } from '@/store/user/selectors';

import { useEffectiveAgentMode } from '../hooks/useEffectiveAgentMode';

export type PlaceholderVariant = 'default' | 'followUp';

interface PlaceholderProps {
  heterogeneousName?: string;
  showAgentAssignmentHint?: boolean;
  variant?: PlaceholderVariant;
}

const Placeholder = memo<PlaceholderProps>(
  ({ heterogeneousName, showAgentAssignmentHint = false, variant = 'default' }) => {
    const useCmdEnterToSend = useUserStore(preferenceSelectors.useCmdEnterToSend);
    const mobile = useServerConfigStore((s) => s.isMobile);
    const wrapperShortcut = useCmdEnterToSend
      ? KeyEnum.Enter
      : combineKeys([KeyEnum.Mod, KeyEnum.Enter]);
    const { t } = useTranslation('chat');

    const agentId = useAgentId();
    const { isAgentRuntimeMode } = useEffectiveAgentMode(agentId);

    const isHeterogeneous = !!heterogeneousName;

    if (variant === 'followUp') {
      return (
        <span>
          {t(isHeterogeneous ? 'followUpPlaceholderHeterogeneous' : 'followUpPlaceholder')}
        </span>
      );
    }

    // Mobile sends through the send button, so a send-key hint would be wrong there.
    if (mobile && !isHeterogeneous) {
      return (
        <span>{t(isAgentRuntimeMode ? 'sendPlaceholderMobile' : 'sendPlaceholderChatMobile')}</span>
      );
    }

    const i18nKey = isHeterogeneous
      ? 'sendPlaceholderHeterogeneous'
      : isAgentRuntimeMode
        ? showAgentAssignmentHint
          ? 'sendPlaceholderWithAgentAssignment'
          : 'sendPlaceholder'
        : showAgentAssignmentHint
          ? 'sendPlaceholderChatWithAgentAssignment'
          : 'sendPlaceholderChat';

    return (
      <Flexbox horizontal align={'center'} as={'span'} gap={4} wrap={'wrap'}>
        <Trans
          i18nKey={i18nKey}
          ns={'chat'}
          values={isHeterogeneous ? { name: heterogeneousName } : undefined}
          components={{
            hotkey: (
              <Trans
                i18nKey={'input.warpWithKey'}
                ns={'chat'}
                components={{
                  key: (
                    <Hotkey
                      as={'span'}
                      keys={wrapperShortcut}
                      style={{ color: 'inherit' }}
                      styles={{ kbdStyle: { color: 'inhert' } }}
                      variant={'borderless'}
                    />
                  ),
                }}
              />
            ),
          }}
        />
        {!showAgentAssignmentHint && !isHeterogeneous && '...'}
      </Flexbox>
    );
  },
);

export default Placeholder;
