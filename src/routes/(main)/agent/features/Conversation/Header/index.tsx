'use client';

import { isDesktop } from '@lobechat/const';
import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';

import NavHeader from '@/features/NavHeader';
import OpenInAppButton from '@/features/OpenInAppButton';
import { resolveExecutionTarget } from '@/helpers/executionTarget';
import { useIsGatewayModeEnabled } from '@/helpers/gatewayMode';
import { useEffectiveAgentConfig } from '@/hooks/useEffectiveAgentConfig';
import { useEffectiveWorkingDirectory } from '@/hooks/useEffectiveWorkingDirectory';

import { useAgentContext } from '../useAgentContext';
import HeaderActions from './HeaderActions';
import ShareButton from './ShareButton';
import Tags from './Tags';
import TerminalToggle from './TerminalToggle';
import WorkingPanelToggle from './WorkingPanelToggle';

const headerStyles = createStaticStyles(({ css }) => ({
  container: css`
    position: relative;
    container-name: agent-conv-header;
    container-type: inline-size;
  `,
  leftContent: css`
    overflow: hidden;
    flex: 1 1 auto;
    min-width: 0;
  `,
  slotLeft: css`
    overflow: hidden;
    flex: 1 1 auto;
    min-width: 0;
  `,
  slotRight: css`
    flex: 0 0 auto;
    min-width: 0;
  `,
}));

const Header = memo(() => {
  const context = useAgentContext();
  const { config, executionTargetError, isExecutionTargetLoading, workspaceScoped } =
    useEffectiveAgentConfig(context);
  const workingDirectory = useEffectiveWorkingDirectory(context) ?? '';
  const deviceRoutingAvailable = useIsGatewayModeEnabled(context.agentId);
  const executionTarget = resolveExecutionTarget(config?.agencyConfig, {
    clientExecutionAvailable: isDesktop,
    deviceRoutingAvailable,
    isHetero: !!config?.agencyConfig?.heterogeneousProvider,
    workspaceScoped,
  });
  const isLocalSystemEnabled =
    !executionTargetError && !isExecutionTargetLoading && executionTarget === 'local';

  return (
    <div className={headerStyles.container}>
      <NavHeader
        left={
          <Flexbox
            allowShrink
            horizontal
            align={'center'}
            className={headerStyles.leftContent}
            gap={4}
            style={{ backgroundColor: cssVar.colorBgContainer }}
          >
            <Tags />
            <HeaderActions />
          </Flexbox>
        }
        right={
          <Flexbox
            horizontal
            align={'center'}
            gap={4}
            style={{ backgroundColor: cssVar.colorBgContainer }}
          >
            {isLocalSystemEnabled && <OpenInAppButton workingDirectory={workingDirectory} />}
            <ShareButton />
            <TerminalToggle />
            <WorkingPanelToggle />
          </Flexbox>
        }
        slotClassNames={{
          left: headerStyles.slotLeft,
          right: headerStyles.slotRight,
        }}
      />
    </div>
  );
});

export default Header;
