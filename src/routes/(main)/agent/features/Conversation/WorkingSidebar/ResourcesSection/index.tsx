import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import AgentDocumentsGroup from './AgentDocumentsGroup';
import SkillsGroup from './SkillsGroup';

interface ResourcesSectionProps {
  /** Bound remote device id (device mode); skills are then scanned over RPC. */
  deviceId?: string;
  /**
   * Whether this pane is actually visible (panel open + resources tab active).
   * Gates the agent-document fetch so a collapsed sidebar doesn't pull the full
   * list on conversation enter.
   */
  enabled?: boolean;
  isHetero: boolean;
  workingDirectory?: string;
}

const ResourcesSection = memo<ResourcesSectionProps>(
  ({ deviceId, enabled = true, isHetero, workingDirectory }) => (
    <Flexbox
      data-testid="workspace-resources"
      flex={1}
      gap={16}
      paddingBlock={8}
      paddingInline={'8px 12px'}
      style={{ minHeight: 0 }}
    >
      {isHetero && workingDirectory && (
        <SkillsGroup deviceId={deviceId} workingDirectory={workingDirectory} />
      )}
      {!isHetero && (
        <AgentDocumentsGroup
          deviceId={deviceId}
          enabled={enabled}
          style={{ flex: 1, minHeight: 0 }}
          workingDirectory={workingDirectory}
        />
      )}
    </Flexbox>
  ),
);

ResourcesSection.displayName = 'ResourcesSection';

export default ResourcesSection;
