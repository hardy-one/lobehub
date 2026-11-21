import { escapeXml } from '@lobechat/prompts';
import type { RuntimeSelectedSkill } from '@lobechat/types';
import debug from 'debug';
import { Md5 } from 'ts-md5';

import { BaseLastUserContentProvider } from '../base/BaseLastUserContentProvider';
import { CONTEXT_INSTRUCTION, SYSTEM_CONTEXT_END, SYSTEM_CONTEXT_START } from '../base/constants';
import {
  type InjectionSnapshotStore,
  lastUserSelectedSkillsKey,
} from '../injection/InjectionSnapshotStore';
import type { Message, PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    selectedSkillContext?: {
      injected: boolean;
      skillsCount: number;
    };
    selectedSkillInjectionCreatedAt?: number;
    /** T-195 P2: source-derived tail-slot identity (no Date.now()/random). */
    selectedSkillInjectionId?: string;
  }
}

const log = debug('context-engine:provider:SelectedSkillInjector');

export interface SelectedSkillInjectorConfig {
  enabled?: boolean;
  selectedSkills?: RuntimeSelectedSkill[];
  /**
   * T-195 批 B / C3 (M2): the session store records the last projected snapshot
   * for audit only. Byte-stability of [0,k) comes from tail-slot placement, not
   * from reusing this value — C3 genuinely churns.
   */
  snapshotStore?: InjectionSnapshotStore;
  topicId?: string;
}

export const formatSelectedSkills = (selectedSkills: RuntimeSelectedSkill[]): string | null => {
  if (selectedSkills.length === 0) return null;

  const lines = [
    'The user explicitly selected these skills for this request. Their full instructions are already loaded below — do NOT call activateSkill for these skills, use the provided content directly.',
    '<selected_skills>',
  ];

  for (const skill of selectedSkills) {
    if (skill.content) {
      lines.push(
        `  <skill identifier="${escapeXml(skill.identifier)}" name="${escapeXml(skill.name)}">`,
        skill.content,
        '  </skill>',
      );
    } else {
      lines.push(
        `  <skill identifier="${escapeXml(skill.identifier)}" name="${escapeXml(skill.name)}" />`,
      );
    }
  }

  lines.push('</selected_skills>');

  return lines.join('\n');
};

/**
 * Format selected skills as a complete system-context block for message content persistence.
 * Returns null if no skills with content are provided.
 */
export const formatSelectedSkillsContext = (
  selectedSkills: RuntimeSelectedSkill[],
): string | null => {
  const inner = formatSelectedSkills(selectedSkills);
  if (!inner) return null;

  return [
    SYSTEM_CONTEXT_START,
    CONTEXT_INSTRUCTION,
    `<selected_skill_context>`,
    inner,
    `</selected_skill_context>`,
    SYSTEM_CONTEXT_END,
  ].join('\n');
};

/**
 * Extract skill identifiers @mentioned in earlier messages via their persisted editorData.
 * Walks the Lexical JSON tree looking for action-tag nodes with actionCategory === 'skill'.
 */
const collectMentionedSkillIds = (
  messages: PipelineContext['messages'],
  excludeIndex: number,
): Set<string> => {
  const ids = new Set<string>();
  for (let i = 0; i < messages.length; i++) {
    if (i === excludeIndex) continue;
    const ed = messages[i].editorData;
    if (!ed) continue;
    walkActionTags(ed.root, (category, type) => {
      if (category === 'skill' && type) ids.add(String(type));
    });
  }
  return ids;
};

/** Walk Lexical JSON tree to find action-tag nodes. */
const walkActionTags = (node: any, cb: (category: string, type: string) => void): void => {
  if (!node) return;
  if (node.type === 'action-tag') {
    cb(node.actionCategory, node.actionType);
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) walkActionTags(child, cb);
  }
};

/** Deterministic epoch from an unknown createdAt value (never wall clock). */
const toEpoch = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const t = Date.parse(value);
    if (Number.isFinite(t)) return t;
  }
  return 0;
};

/**
 * T-193 §2.7.1 anchor u: last real user = role 'user' without injection markers.
 * Implemented locally in C3/C5 so no shared base is touched (scope: only C3/C5).
 */
const findLastRealUserIndex = (messages: PipelineContext['messages']): number => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    const meta: any = (m as any).meta;
    if (meta?.systemInjection || meta?.injectType || meta?.virtualLastUser || meta?.steer) continue;
    return i;
  }
  return -1;
};

/**
 * Selected Skill Injector
 * Appends user-selected slash-menu skills to the last user message as ephemeral context.
 *
 * T-195 批 B / C3: M2 projection whose genuine per-operation churn (selectedSkills
 * + historical @mention dedup) is confined to a deterministic tail slot. The real
 * user message is never touched, so the [0,k) prefix stays byte-identical.
 */
export class SelectedSkillInjector extends BaseLastUserContentProvider {
  readonly name = 'SelectedSkillInjector';

  constructor(
    private config: SelectedSkillInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    // ---- Original trigger expressions, verbatim (P5) ----
    if (this.config.enabled === false) return this.markAsExecuted(context);

    const clonedContext = this.cloneContext(context);
    const allSelectedSkills = this.config.selectedSkills ?? [];

    if (allSelectedSkills.length === 0) {
      log('No selected skills, skipping injection');
      return this.markAsExecuted(clonedContext);
    }
    // Deduplicate: skip skills already @mentioned in earlier messages (via editorData)
    const lastUserIndex = findLastRealUserIndex(clonedContext.messages);

    if (lastUserIndex === -1) {
      log('No user messages found, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    const previousIds = collectMentionedSkillIds(clonedContext.messages, lastUserIndex);
    const selectedSkills =
      previousIds.size > 0
        ? allSelectedSkills.filter((s) => !previousIds.has(s.identifier))
        : allSelectedSkills;

    if (selectedSkills.length < allSelectedSkills.length) {
      log(
        'Deduplicated %d skills already @mentioned in earlier messages (via editorData)',
        allSelectedSkills.length - selectedSkills.length,
      );
    }

    if (selectedSkills.length === 0) {
      log('All selected skills already injected in earlier messages, skipping');
      return this.markAsExecuted(clonedContext);
    }

    const content = formatSelectedSkills(selectedSkills);

    if (!content) {
      log('No selected skill content generated, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    // ---- T-195 change: project into a deterministic tail slot, not into u.content ----
    // The SYSTEM_CONTEXT wrapper template and constants are unchanged (P5); a fresh
    // tail message always carries the full single-segment wrapper.
    const contentToAppend = this.wrapWithSystemContext(content, 'selected_skill_context');

    // Source-derived fingerprint (selectedSkills + historical @mention ids) → id.
    // Identity uses the source fingerprint only — no wall-clock or random component (P2).
    const fingerprintSrc = JSON.stringify(selectedSkills) + '|' + [...previousIds].sort().join(',');
    const fingerprint = Md5.hashStr(fingerprintSrc);
    const injectionId = `inject:lastUser:selectedSkills:${fingerprint}`;
    const carrierCreatedAt = toEpoch(clonedContext.messages[lastUserIndex].createdAt);

    const tailMessage: Message = {
      content: contentToAppend,
      createdAt: carrierCreatedAt,
      id: injectionId,
      meta: { injectType: 'selected-skills', virtualLastUser: true },
      role: 'user' as const,
      updatedAt: carrierCreatedAt,
    };
    clonedContext.messages.push(tailMessage);

    // Audit-only M2 projection snapshot (not used for reuse).
    const { snapshotStore, topicId } = this.config;
    if (snapshotStore && topicId) {
      snapshotStore.set(lastUserSelectedSkillsKey(topicId), {
        fingerprint,
        selectedSkills,
      });
    }
    clonedContext.metadata.selectedSkillInjectionId = injectionId;
    clonedContext.metadata.selectedSkillInjectionCreatedAt = carrierCreatedAt;

    clonedContext.metadata.selectedSkillContext = {
      injected: true,
      skillsCount: selectedSkills.length,
    };

    log('Selected skill context projected to tail slot, skills count: %d', selectedSkills.length);

    return this.markAsExecuted(clonedContext);
  }
}
