import type {
  HeterogeneousAgentMode,
  HeterogeneousProviderConfig,
  HeterogeneousReasoningEffort,
  HeterogeneousSpeedMode,
  HeterogeneousTopicPin,
  HeteroSelection,
  HeteroSelectorCapability,
  ListHeterogeneousAgentModelsParams,
} from '@lobechat/types';
import { HETEROGENEOUS_AGENT_DEFAULT_SELECTION } from '@lobechat/types';
import {
  DropdownMenuPopup,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuRoot,
  DropdownMenuTrigger,
  renderDropdownMenuItems,
} from '@lobehub/ui';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { buildSelectorSubmenu } from '../../components/buildSelectorSubmenu';
import Trigger from '../../components/SelectorTrigger';
import { ModelCatalogSelector } from './ModelCatalogSelector';
import { buildSelectorView, resolveModelSwitchSelection } from './selectorView';
import { useTargetModelCatalog } from './useTargetModelCatalog';
import { useThinkingLevels } from './useThinkingLevels';

interface SelectorMenuProps {
  agentId?: string;
  capability: HeteroSelectorCapability;
  patch: (selection: HeteroSelection) => Promise<void>;
  permissionReason?: string;
  provider: HeterogeneousProviderConfig;
  topicPin?: HeterogeneousTopicPin;
  topicScoped?: boolean;
}

const SelectorMenu = memo<SelectorMenuProps>(
  ({ agentId, capability, patch, permissionReason, provider, topicPin, topicScoped }) => {
    const { t } = useTranslation('chat');
    const [open, setOpen] = useState(false);
    const type = provider.type as ListHeterogeneousAgentModelsParams['type'];
    const { cwd, data, deviceId, targetReady } = useTargetModelCatalog({
      agentId,
      enabled: !!capability.speed,
      open,
      type,
    });
    const models = data?.models;

    const effort = capability.effort?.resolve(provider);
    const probesLevels = capability.effort?.source === 'runtime';
    // Only probe while the menu is open on a target that can answer: the probe
    // costs a CLI process start, and a device target keeps the static list.
    const { levels: runtimeEffortLevels } = useThinkingLevels({
      cwd,
      deviceId,
      enabled: open && probesLevels && targetReady,
      provider,
      type,
    });

    // A level the model does not serve would be clamped by the CLI, leaving the
    // menu claiming a setting the run never used — drop it once we know better.
    useEffect(() => {
      if (!runtimeEffortLevels || !effort || effort === HETEROGENEOUS_AGENT_DEFAULT_SELECTION)
        return;
      if (runtimeEffortLevels.includes(effort)) return;

      void patch({ effort: HETEROGENEOUS_AGENT_DEFAULT_SELECTION });
    }, [effort, patch, runtimeEffortLevels]);

    const view = useMemo(
      () =>
        buildSelectorView({
          capability,
          models,
          provider,
          runtimeEffortLevels,
          t,
          topicPin,
          topicScoped,
        }),
      [capability, models, provider, runtimeEffortLevels, t, topicPin, topicScoped],
    );

    const select = useCallback(
      (key: string, value: string) => {
        if (key === 'model' && capability.model)
          return void patch(
            resolveModelSwitchSelection({
              capability: { ...capability, model: capability.model },
              effort: capability.effort?.resolve(provider),
              models,
              speed: view.speed,
              value,
            }),
          );

        if (key === 'mode') return void patch({ mode: value as HeterogeneousAgentMode });
        if (key === 'speed') return void patch({ speed: value as HeterogeneousSpeedMode });

        void patch({ effort: value as HeterogeneousReasoningEffort });
      },
      [capability, models, patch, provider, view.speed],
    );

    const items = view.dimensions.map((dimension) =>
      buildSelectorSubmenu({
        current: dimension.current,
        label: dimension.label,
        onSelect: (value: string) => select(dimension.key, value),
        options: dimension.options,
        valueLabel: dimension.valueLabel,
      }),
    );

    return (
      <DropdownMenuRoot open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger nativeButton={false}>
          <Trigger
            ariaLabel={view.ariaLabel}
            fast={view.isFastSpeed}
            modelId={view.model}
            secondaryText={view.triggerLabel.secondaryText}
            text={view.triggerLabel.text}
          />
        </DropdownMenuTrigger>
        <DropdownMenuPortal>
          {/* The trigger label changes width as selections change, and it sits in the
              right-anchored send area — only its right edge holds still. Aligning to
              the left edge drags the open popup sideways on every pick. */}
          <DropdownMenuPositioner placement="topRight" sideOffset={8}>
            <DropdownMenuPopup style={{ width: 240 }}>
              {view.isCatalogModel && (
                <ModelCatalogSelector
                  agentId={agentId}
                  disabled={false}
                  model={view.model}
                  permissionReason={permissionReason}
                  type={provider.type as ListHeterogeneousAgentModelsParams['type']}
                  variant="submenu"
                  onSelect={(value) => select('model', value)}
                />
              )}
              {renderDropdownMenuItems(items)}
            </DropdownMenuPopup>
          </DropdownMenuPositioner>
        </DropdownMenuPortal>
      </DropdownMenuRoot>
    );
  },
);

SelectorMenu.displayName = 'HeteroModelSelectorMenu';

export default SelectorMenu;
