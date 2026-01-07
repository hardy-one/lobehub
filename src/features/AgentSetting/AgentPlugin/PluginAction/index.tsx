import { STANDARD_INBOX_TOOLS } from '@lobechat/builtin-agents';
import { Flexbox } from '@lobehub/ui';
import { Switch } from 'antd';
import isEqual from 'fast-deep-equal';
import { memo, useMemo } from 'react';

import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useToolStore } from '@/store/tool';

import { useStore } from '../../store';

// Set of standard inbox tools for quick lookup
const STANDARD_INBOX_TOOLS_SET: Set<string> = new Set(STANDARD_INBOX_TOOLS);

const PluginSwitch = memo<{ identifier: string }>(({ identifier }) => {
  const pluginManifestLoading = useToolStore((s) => s.pluginInstallLoading, isEqual);
  const [userEnabledPlugins, hasPlugin, toggleAgentPlugin] = useStore((s) => [
    s.config.plugins || [],
    !!s.config.plugins,
    s.toggleAgentPlugin,
  ]);

  // Check if standard inbox tools are enabled and if this is the inbox agent
  const enableStandardInboxTools = useServerConfigStore(
    serverConfigSelectors.enableStandardInboxTools,
  );
  const isInboxAgent = useAgentStore(builtinAgentSelectors.isInboxAgent);

  // Check if this is a standard tool that should be force-enabled
  // Only applies to inbox agent when enableStandardInboxTools is true
  const isForceEnabled = useMemo(
    () => isInboxAgent && enableStandardInboxTools && STANDARD_INBOX_TOOLS_SET.has(identifier),
    [isInboxAgent, enableStandardInboxTools, identifier],
  );

  return (
    <Flexbox align={'center'} gap={8} horizontal>
      <Switch
        checked={
          isForceEnabled ||
          // 如果在加载中，说明激活了
          (pluginManifestLoading[identifier] || !hasPlugin
            ? false
            : userEnabledPlugins.includes(identifier))
        }
        disabled={isForceEnabled}
        loading={pluginManifestLoading[identifier]}
        onChange={() => {
          if (!isForceEnabled) {
            toggleAgentPlugin(identifier);
          }
        }}
      />
    </Flexbox>
  );
});

export default PluginSwitch;
