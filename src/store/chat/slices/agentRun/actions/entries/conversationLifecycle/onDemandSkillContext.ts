import { formatSelectedSkillsContext } from '@lobechat/context-engine';
import type { AgentContextMode, LobeAgentChatConfig, RuntimeSelectedSkill } from '@lobechat/types';
import { resolveContextMode } from '@lobechat/types';

import { isCanUseFC } from '@/helpers/isCanUseFC';

interface AgentModeFacts {
  chatConfig?: Pick<LobeAgentChatConfig, 'contextMode' | 'enableAgentMode' | 'toolMode'> | null;
  model?: string;
  provider?: string;
}

export const resolveOnDemandSkillDelivery = (
  agentConfig: AgentModeFacts | null | undefined,
  selectedSkills: RuntimeSelectedSkill[],
) => {
  const contextMode = resolveContextMode(agentConfig?.chatConfig, {
    supportToolUse: isCanUseFC(agentConfig?.model ?? '', agentConfig?.provider ?? ''),
  });

  return {
    contextMode,
    selectedSkills:
      contextMode === 'on-demand' && selectedSkills.length > 0 ? selectedSkills : undefined,
  };
};

/** On-demand skill bodies travel as provenance-bearing suffix messages. */
export const formatPersistedSelectedSkillsContext = (
  contextMode: AgentContextMode,
  selectedSkills: RuntimeSelectedSkill[],
) => (contextMode === 'on-demand' ? null : formatSelectedSkillsContext(selectedSkills));

export const toOnDemandSelectedSkillsInitialContext = (
  selectedSkills: RuntimeSelectedSkill[] | undefined,
) => (selectedSkills ? { selectedSkills } : undefined);
