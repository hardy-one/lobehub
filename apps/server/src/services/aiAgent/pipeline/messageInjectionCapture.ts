import type { LobeToolManifest, OperationSkillSet } from '@lobechat/context-engine';
import {
  formatMentionedAgentsContext,
  formatSelectedSkillsContext,
  formatSelectedToolsContext,
} from '@lobechat/context-engine';
import {
  INJECTION_SOURCE_KEYS,
  type InjectionSourceKey,
  type RuntimeMentionedAgent,
  type RuntimeSelectedSkill,
  type RuntimeSelectedTool,
} from '@lobechat/types';
import debug from 'debug';

import type { MessageModel } from '@/database/models/message';

const log = debug('lobe-server:ai-agent-service');

export interface MessageInjectionCaptureInput {
  mentionedAgents?: RuntimeMentionedAgent[];
  selectedSkillIds?: string[];
  selectedToolIds?: string[];
  /** The run's prepared skill pool — reused for the exact selected skill bodies. */
  skillSet?: OperationSkillSet;
  /** The run's discovered manifests — reused for the exact selected tool bodies. */
  toolManifestMap?: Record<string, LobeToolManifest>;
}

export interface MessageInjectionRow {
  content: string;
  sourceKey: InjectionSourceKey;
}

export interface InjectionSourceFailure {
  error: unknown;
  sourceKey: string;
}

export interface CaptureMessageInjectionsResult {
  failed: InjectionSourceFailure[];
  written: Awaited<ReturnType<MessageModel['appendInjectionRow']>>[];
}

const uniqueIds = (ids?: string[]): string[] => {
  if (!ids?.length) return [];

  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
};

/**
 * Mirror the client-side `loadToolContent` rule: a preloaded tool body is its
 * system role plus one line per API. `SelectedToolInjector` renders this body
 * verbatim, so the persisted row stays byte-identical to the legacy output.
 */
const resolveToolContent = (manifest?: LobeToolManifest): string | undefined => {
  if (!manifest) return undefined;

  const parts: string[] = [];
  if (manifest.systemRole) parts.push(manifest.systemRole);
  if (manifest.api?.length) {
    const apiDescriptions = manifest.api
      .map((api) => `- ${api.name}: ${api.description}`)
      .join('\n');
    parts.push(`Available APIs:\n${apiDescriptions}`);
  }

  return parts.join('\n\n') || undefined;
};

const resolveToolName = (identifier: string, manifest?: LobeToolManifest): string => {
  const meta = manifest?.meta as { name?: unknown; title?: unknown } | undefined;
  return (
    (typeof meta?.title === 'string' && meta.title) ||
    (typeof meta?.name === 'string' && meta.name) ||
    identifier
  );
};

/**
 * Build the injected rows a turn's message carries, in the order the legacy
 * injectors produce them: mention delegation, selected skills, selected tools.
 * Pure: the same input always yields the same rows.
 */
export const buildMessageInjectionRows = ({
  mentionedAgents,
  selectedSkillIds,
  selectedToolIds,
  skillSet,
  toolManifestMap,
}: MessageInjectionCaptureInput): MessageInjectionRow[] => {
  const rows: MessageInjectionRow[] = [];

  if (mentionedAgents?.length) {
    rows.push({
      content: formatMentionedAgentsContext(mentionedAgents),
      sourceKey: INJECTION_SOURCE_KEYS.MENTION_DELEGATION,
    });
  }

  const skillIds = uniqueIds(selectedSkillIds);
  if (skillIds.length) {
    const skillById = new Map((skillSet?.skills ?? []).map((skill) => [skill.identifier, skill]));
    const selectedSkills: RuntimeSelectedSkill[] = skillIds.map((identifier) => {
      const skill = skillById.get(identifier);
      return {
        ...(skill?.content ? { content: skill.content } : undefined),
        identifier,
        name: skill?.name ?? identifier,
      };
    });
    const content = formatSelectedSkillsContext(selectedSkills);
    if (content) {
      rows.push({ content, sourceKey: INJECTION_SOURCE_KEYS.SELECTED_SKILL });
    }
  }

  const toolIds = uniqueIds(selectedToolIds);
  if (toolIds.length) {
    const selectedTools: RuntimeSelectedTool[] = toolIds.map((identifier) => {
      const manifest = toolManifestMap?.[identifier];
      const content = resolveToolContent(manifest);
      return {
        ...(content ? { content } : undefined),
        identifier,
        name: resolveToolName(identifier, manifest),
      };
    });
    const content = formatSelectedToolsContext(selectedTools);
    if (content) {
      rows.push({ content, sourceKey: INJECTION_SOURCE_KEYS.SELECTED_TOOL });
    }
  }

  return rows;
};

export interface CaptureMessageInjectionsParams extends MessageInjectionCaptureInput {
  /**
   * Timestamp immediately after the user row this turn persisted. Rows are
   * spaced one millisecond apart so the timeline replay order stays stable
   * and keeps them between the user turn and the assistant placeholder.
   */
  anchorCreatedAt?: number;
  anchorMessageId?: string;
  assistantCreatedAt?: number;
  messageModel: Pick<MessageModel, 'appendInjectionRow' | 'findById'>;
  threadId?: string | null;
  topicId: string;
}

/**
 * The single message-ingestion hook for append-only v2 writes. Runs once per
 * persisted user turn and dispatches to every source the message carries, so
 * the three call sites can never drift into separate implementations.
 *
 * Batch 0-C2: each source is written in its own try/catch. One source failing
 * never blocks the others (fail-open; there is currently no fail-closed source).
 * The result reports which sources were written and which failed with their
 * `sourceKey` + `error`, so callers can log per-source failures.
 */
export const captureMessageInjections = async ({
  assistantCreatedAt,
  anchorMessageId,
  anchorCreatedAt,
  threadId,
  messageModel,
  topicId,
  ...input
}: CaptureMessageInjectionsParams): Promise<CaptureMessageInjectionsResult> => {
  const rows = buildMessageInjectionRows(input);
  const written: CaptureMessageInjectionsResult['written'] = [];
  const failed: InjectionSourceFailure[] = [];
  let anchorThreadId: string | null | undefined;
  try {
    anchorThreadId =
      threadId ??
      (anchorMessageId ? (await messageModel.findById(anchorMessageId))?.threadId : undefined);
  } catch (error) {
    // An anchor lookup is shared by every source. If it fails we still attempt
    // each row with the explicit `threadId` (possibly undefined) — a missing
    // thread tag is better than silently dropping all injection context.
    log('captureMessageInjections: anchor thread lookup failed for topic %s: %O', topicId, error);
  }
  const maxOffset =
    anchorCreatedAt === undefined || assistantCreatedAt === undefined
      ? undefined
      : Math.max(0, Math.min(rows.length - 1, assistantCreatedAt - 1 - anchorCreatedAt));

  for (const [index, row] of rows.entries()) {
    const offset = maxOffset === undefined ? index : Math.min(index, maxOffset);
    try {
      const inserted = await messageModel.appendInjectionRow(
        topicId,
        row.sourceKey,
        row.content,
        'user',
        {
          anchorMessageId,
          ...(anchorCreatedAt === undefined ? {} : { createdAt: anchorCreatedAt + offset }),
          threadId: anchorThreadId,
        },
      );
      written.push(inserted);
    } catch (error) {
      failed.push({ error, sourceKey: row.sourceKey });
      log(
        'captureMessageInjections: failed to persist %s for topic %s: %O',
        row.sourceKey,
        topicId,
        error,
      );
    }
  }

  if (written.length > 0) {
    log(
      'captureMessageInjections: persisted %d row(s) for topic %s (%s)',
      written.length,
      topicId,
      written.map((row) => row.sourceKey).join(', '),
    );
  }
  if (failed.length > 0) {
    log(
      'captureMessageInjections: %d source(s) failed for topic %s (%s)',
      failed.length,
      topicId,
      failed.map((entry) => entry.sourceKey).join(', '),
    );
  }

  return { failed, written };
};
