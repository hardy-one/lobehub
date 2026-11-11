import { type SkillItem, type SkillSource, skillsPrompts } from '@lobechat/prompts';
import debug from 'debug';

import { BaseSystemRoleProvider } from '../base/BaseSystemRoleProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    skillContext?: {
      injected: boolean;
      skillsCount: number;
    };
  }
}

const log = debug('context-engine:provider:SkillContextProvider');

/**
 * Lightweight skill metadata for context injection
 * Compatible with the SkillMeta that will be added in @lobechat/types (Phase 3.2)
 */
export interface SkillMeta {
  /**
   * When true, the skill's content is directly injected into the system prompt
   * instead of only appearing in the <available_skills> list.
   */
  activated?: boolean;
  /**
   * Full skill content to inject when activated.
   * Only used when `activated` is true.
   */
  content?: string;
  description: string;
  identifier: string;
  location?: string;
  name: string;
  /**
   * Skill origin. `project` skills are discovered on the device filesystem and
   * loaded on demand via the readFile tool (see `location`).
   */
  source?: SkillSource;
}

/**
 * Skill Context Provider Configuration
 */
export interface SkillContextProviderConfig {
  /**
   * Clip each description to {@link SKILL_DESCRIPTION_MAX_CHARS}. Set when the
   * run loads tool manuals on demand, where the list exists to say what is
   * activatable and the full text arrives with `activateSkill`.
   */
  clipDescriptions?: boolean;
  enabled?: boolean;
  enabledSkills?: SkillMeta[];
}

/**
 * Select the activated skills whose full content gets injected into the system
 * prompt by SkillContextProvider.
 *
 * Exported so ActivationResultTrimProcessor can decide, with the exact same
 * predicate, whether an activateSkill tool result's full content is already
 * carried by the system prompt and can therefore be trimmed from history.
 */
export const selectActivatedSkills = (enabledSkills?: SkillMeta[]): SkillMeta[] =>
  (enabledSkills ?? []).filter((s) => s.activated && s.content);

/**
 * Longest skill description kept in `<available_skills>`.
 *
 * The list only has to say what a skill is for; the full description sits in
 * the skill's own SKILL.md and arrives with `activateSkill`. Descriptions are
 * authored per skill and cannot be rewritten here, so this is a hard clip.
 */
const SKILL_DESCRIPTION_MAX_CHARS = 100;

const clipSkillDescription = (description: string): string => {
  const normalized = description.trim().replaceAll(/\s+/g, ' ');
  if (normalized.length <= SKILL_DESCRIPTION_MAX_CHARS) return normalized;
  return `${normalized.slice(0, SKILL_DESCRIPTION_MAX_CHARS - 1)}…`;
};

/**
 * Skill Context Provider
 * Injects lightweight skill metadata into the system prompt so the LLM knows
 * which skills are available and can invoke them via `activateSkill`.
 */
export class SkillContextProvider extends BaseSystemRoleProvider {
  readonly name = 'SkillContextProvider';

  constructor(
    private config: SkillContextProviderConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected buildSystemRoleContent(_context: PipelineContext): string | null {
    if (this.config.enabled === false) return null;

    const { enabledSkills } = this.config;

    if (!enabledSkills || enabledSkills.length === 0) {
      log('No enabled skills, skipping injection');
      return null;
    }

    // Separate activated skills (inject content directly) from available skills (list only)
    const activatedSkills = selectActivatedSkills(enabledSkills);
    const availableSkills = enabledSkills.filter((s) => !s.activated);

    const contentParts: string[] = [];

    // Inject activated skill content directly into system prompt
    for (const skill of activatedSkills) {
      contentParts.push(skill.content!);
      log('Auto-activated skill: %s', skill.identifier);
    }

    // Generate <available_skills> list for non-activated skills
    if (availableSkills.length > 0) {
      const skills: SkillItem[] = availableSkills.map((skill) => ({
        description: this.config.clipDescriptions
          ? clipSkillDescription(skill.description)
          : skill.description,
        identifier: skill.identifier,
        location: skill.location,
        name: skill.name,
        source: skill.source,
      }));

      const availableSkillsContent = skillsPrompts(skills);
      if (availableSkillsContent) {
        contentParts.push(availableSkillsContent);
      }
    }

    if (contentParts.length === 0) {
      log('No skill content generated, skipping injection');
      return null;
    }

    log(
      'Skill context prepared: %d activated, %d available',
      activatedSkills.length,
      availableSkills.length,
    );
    return contentParts.join('\n\n');
  }

  protected onInjected(context: PipelineContext): void {
    context.metadata.skillContext = {
      injected: true,
      skillsCount: this.config.enabledSkills?.length ?? 0,
    };
  }
}
