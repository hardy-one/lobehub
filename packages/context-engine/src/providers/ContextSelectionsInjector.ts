import { formatContextSelections } from '@lobechat/prompts';
import type { ContextSelection, PageSelection } from '@lobechat/types';
import debug from 'debug';

import { BaseEveryUserContentProvider } from '../base/BaseEveryUserContentProvider';
import type { Message, ProcessorOptions } from '../types';

const log = debug('context-engine:provider:ContextSelectionsInjector');

/**
 * Messages persisted before `metadata.contextSelections` existed only carry
 * `metadata.pageSelections`. Project those onto the generic shape so old turns
 * keep injecting; the page-selection rendering itself is unchanged.
 */
const fromLegacyPageSelections = (
  selections: PageSelection[] | undefined,
): ContextSelection[] | undefined =>
  selections?.map((selection) => ({
    content: selection.content,
    id: selection.id,
    lineRange:
      selection.startLine === undefined
        ? undefined
        : { endLine: selection.endLine ?? selection.startLine, startLine: selection.startLine },
    pageId: selection.pageId,
    source: 'page',
    title: selection.title,
    xml: selection.xml,
  }));

export interface ContextSelectionsInjectorConfig {
  /** Whether generic contextSelections injection is enabled */
  enabled?: boolean;
  mcpAppsEnabled?: boolean;
}

/**
 * Injects generic user-attached context selections into each user message that owns them.
 *
 * These selections are not page-editor selections: they can come from chat text,
 * code snippets, page selections normalized into the generic format, or other
 * future context sources.
 *
 * T-193 §1.3 M2 / T-199 c4e1c67b: the wrapper is a PURE FUNCTION of the
 * current user's already-persisted, immutable metadata — `contextSelections`
 * when present, otherwise the legacy `pageSelections` projection (those writes
 * still happen for compatibility, see metadata.ts and operation/types.ts). It
 * is recomputed byte-identically inside each processing pass and appended to
 * the payload in place. Nothing derived here is written to a snapshot store, to
 * pipeline metadata, or to any UI state — the injection exists only as a local
 * result in the messages sent upstream.
 */
export class ContextSelectionsInjector extends BaseEveryUserContentProvider {
  readonly name = 'ContextSelectionsInjector';

  constructor(
    private config: ContextSelectionsInjectorConfig = {},
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected buildContentForMessage(
    message: Message,
    index: number,
  ): { content: string; contextType: string } | null {
    if (!this.config.enabled) {
      return null;
    }

    // M2: derive purely from the immutable, already-persisted metadata. No read
    // from or write to any session/metadata/UI state.
    const contextSelections =
      (message.metadata?.contextSelections as ContextSelection[] | undefined) ??
      fromLegacyPageSelections(message.metadata?.pageSelections as PageSelection[] | undefined);

    if (!contextSelections || contextSelections.length === 0) {
      return null;
    }

    const formattedSelections = formatContextSelections(
      contextSelections.filter(
        (selection) => selection.source !== 'mcpApp' || this.config.mcpAppsEnabled,
      ),
    );

    if (!formattedSelections) return null;

    log(
      `Building generic context selections for message at index ${index} with ${contextSelections.length} selections`,
    );

    return {
      content: formattedSelections,
      contextType: 'user_context_selections',
    };
  }
}
