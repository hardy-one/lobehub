import { formatContextSelections } from '@lobechat/prompts';
import type { ContextSelection, PageSelection } from '@lobechat/types';
import debug from 'debug';

import { BaseEveryUserContentProvider } from '../base/BaseEveryUserContentProvider';
import type { Message, ProcessorOptions } from '../types';

const log = debug('context-engine:provider:ContextSelectionsInjector');

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

export const formatMessageContextSelections = (
  selections: ContextSelection[] | undefined,
  mcpAppsEnabled = false,
): string | undefined => {
  if (!selections?.length) return undefined;

  const formatted = formatContextSelections(
    selections.filter((selection) => selection.source !== 'mcpApp' || mcpAppsEnabled),
  );
  return formatted || undefined;
};

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

    const contextSelections =
      (message.metadata?.contextSelections as ContextSelection[] | undefined) ??
      fromLegacyPageSelections(message.metadata?.pageSelections as PageSelection[] | undefined);
    const formattedSelections = formatMessageContextSelections(
      contextSelections,
      this.config.mcpAppsEnabled,
    );

    if (!formattedSelections) return null;

    log(
      `Building generic context selections for message at index ${index} with ${contextSelections?.length ?? 0} selections`,
    );

    return {
      content: formattedSelections,
      contextType: 'user_context_selections',
    };
  }
}
