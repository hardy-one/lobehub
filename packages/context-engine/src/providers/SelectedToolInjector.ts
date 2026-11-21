import { escapeXml } from '@lobechat/prompts';
import type { RuntimeSelectedTool } from '@lobechat/types';
import debug from 'debug';
import { Md5 } from 'ts-md5';

import { BaseLastUserContentProvider } from '../base/BaseLastUserContentProvider';
import { CONTEXT_INSTRUCTION, SYSTEM_CONTEXT_END, SYSTEM_CONTEXT_START } from '../base/constants';
import type { InjectionSnapshotStore } from '../injection/InjectionSnapshotStore';
import { findLastRealUserIndex, makeTailMessage, toEpoch } from '../injection/lastUserInjection';
import type { PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    selectedToolContext?: {
      injected: boolean;
      toolsCount: number;
    };
    selectedToolInjectionCreatedAt?: number;
    /** T-202 P2: source-derived tail-slot identity (no Date.now()/random). */
    selectedToolInjectionId?: string;
  }
}

const log = debug('context-engine:provider:SelectedToolInjector');

export interface SelectedToolInjectorConfig {
  enabled?: boolean;
  selectedTools?: RuntimeSelectedTool[];
  /**
   * T-202 批 B 剩余 / C4 (M2): accepted for interface symmetry but UNUSED — pure
   * derivation from immutable source, writes nothing to any store. Byte stability
   * of [0,k) comes from deterministic tail-slot placement.
   */
  snapshotStore?: InjectionSnapshotStore;
  topicId?: string;
}

export const formatSelectedTools = (selectedTools: RuntimeSelectedTool[]): string | null => {
  if (selectedTools.length === 0) return null;

  const lines = [
    'The user explicitly selected these tools for this request. Use them proactively without waiting for further instruction.',
    '<selected_tools>',
  ];

  for (const tool of selectedTools) {
    if (tool.content) {
      // Tool has preloaded context — inject full description
      lines.push(
        `  <tool identifier="${escapeXml(tool.identifier)}" name="${escapeXml(tool.name)}">`,
        tool.content,
        '  </tool>',
      );
    } else {
      lines.push(
        `  <tool identifier="${escapeXml(tool.identifier)}" name="${escapeXml(tool.name)}" />`,
      );
    }
  }

  lines.push('</selected_tools>');

  return lines.join('\n');
};

/**
 * Format selected tools as a complete system-context block for message content persistence.
 * Returns null if no tools are provided.
 */
export const formatSelectedToolsContext = (selectedTools: RuntimeSelectedTool[]): string | null => {
  const inner = formatSelectedTools(selectedTools);
  if (!inner) return null;

  return [
    SYSTEM_CONTEXT_START,
    CONTEXT_INSTRUCTION,
    `<selected_tool_context>`,
    inner,
    `</selected_tool_context>`,
    SYSTEM_CONTEXT_END,
  ].join('\n');
};

/**
 * Extract tool identifiers @mentioned in earlier messages via their persisted editorData.
 */
const collectMentionedToolIds = (
  messages: PipelineContext['messages'],
  excludeIndex: number,
): Set<string> => {
  const ids = new Set<string>();
  for (let i = 0; i < messages.length; i++) {
    if (i === excludeIndex) continue;
    const ed = messages[i].editorData;
    if (!ed) continue;
    walkActionTags(ed.root, (category, type) => {
      if (category === 'tool' && type) ids.add(String(type));
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

/**
 * Selected Tool Injector
 * Appends user-selected tools to the last user message as ephemeral context.
 */
export class SelectedToolInjector extends BaseLastUserContentProvider {
  readonly name = 'SelectedToolInjector';

  constructor(
    private config: SelectedToolInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    // Original trigger expression, verbatim (P5).
    if (this.config.enabled === false) return this.markAsExecuted(context);

    const clonedContext = this.cloneContext(context);
    const allSelectedTools = this.config.selectedTools ?? [];

    if (allSelectedTools.length === 0) {
      log('No selected tools, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    // Deduplicate: skip tools already @mentioned in earlier messages (via editorData)
    const lastUserIndex = findLastRealUserIndex(clonedContext.messages);

    if (lastUserIndex === -1) {
      log('No user messages found, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    const previousIds = collectMentionedToolIds(clonedContext.messages, lastUserIndex);
    const selectedTools =
      previousIds.size > 0
        ? allSelectedTools.filter((t) => !previousIds.has(t.identifier))
        : allSelectedTools;

    if (selectedTools.length < allSelectedTools.length) {
      log(
        'Deduplicated %d tools already @mentioned in earlier messages (via editorData)',
        allSelectedTools.length - selectedTools.length,
      );
    }

    if (selectedTools.length === 0) {
      log('All selected tools already injected in earlier messages, skipping');
      return this.markAsExecuted(clonedContext);
    }

    const content = formatSelectedTools(selectedTools);

    if (!content) {
      log('No selected tool content generated, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    // T-202 批 B 剩余 / C4: project into a deterministic virtual tail slot,
    // mirroring C3. P5: the ORIGINAL wrapper-branch template is kept verbatim
    // (byte-for-byte the pre-change branch expressions); only PLACEMENT changed.
    const hasExistingWrapper = this.hasExistingSystemContext(clonedContext);
    const contentToAppend = hasExistingWrapper
      ? this.createContextBlock(content, 'selected_tool_context')
      : this.wrapWithSystemContext(content, 'selected_tool_context');

    // Source-derived fingerprint (selectedTools + historical @mention ids) → id.
    const fingerprintSrc = JSON.stringify(selectedTools) + '|' + [...previousIds].sort().join(',');
    const fingerprint = Md5.hashStr(fingerprintSrc);
    const injectionId = `inject:lastUser:selectedTools:${fingerprint}`;
    const carrierCreatedAt = toEpoch(clonedContext.messages[lastUserIndex].createdAt);

    const tailMessage = makeTailMessage({
      content: contentToAppend,
      createdAt: carrierCreatedAt,
      id: injectionId,
      injectType: 'selected-tools',
    });
    clonedContext.messages.push(tailMessage);

    // T-202 / C4 is M2 pure derivation: it writes NOTHING to any store. Tail-slot
    // bytes come solely from immutable selected-tool source + historical dedup;
    // no session/injection store write, so no UI or store side effect.

    clonedContext.metadata.selectedToolInjectionId = injectionId;
    clonedContext.metadata.selectedToolInjectionCreatedAt = carrierCreatedAt;
    clonedContext.metadata.selectedToolContext = {
      injected: true,
      toolsCount: selectedTools.length,
    };

    log('Selected tool context projected to tail slot, tools count: %d', selectedTools.length);

    return this.markAsExecuted(clonedContext);
  }
}
