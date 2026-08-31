import { formatContextSelection, formatContextSelections } from '@lobechat/prompts';
import {
  CONTEXT_REFERENCE_TAG,
  type ContextSelection,
  decodeContextReferenceId,
} from '@lobechat/types';
import debug from 'debug';

import { BaseEveryUserContentProvider } from '../base/BaseEveryUserContentProvider';
import type { Message, PipelineContext, ProcessorOptions } from '../types';

const log = debug('context-engine:provider:ContextSelectionsInjector');

const CONTEXT_REFERENCE_PATTERN = new RegExp(
  `<${CONTEXT_REFERENCE_TAG}\\s+id="([^"]+)"\\s*/>`,
  'g',
);

interface InlineContextReplacement {
  content: string | any[];
  referencedIds: Set<string>;
}

const replaceInlineContextReferences = (
  content: string | any[],
  selections: ContextSelection[],
): InlineContextReplacement => {
  const selectionsById = new Map(selections.map((selection) => [selection.id, selection]));
  const referencedIds = new Set<string>();

  const replaceText = (text: string): string =>
    text.replace(CONTEXT_REFERENCE_PATTERN, (marker, encodedId: string) => {
      const selection = selectionsById.get(decodeContextReferenceId(encodedId));
      if (!selection) return marker;

      referencedIds.add(selection.id);
      return formatContextSelection(selection);
    });

  if (typeof content === 'string') {
    return { content: replaceText(content), referencedIds };
  }

  return {
    content: content.map((part) => {
      if (
        !part ||
        typeof part !== 'object' ||
        part.type !== 'text' ||
        typeof part.text !== 'string'
      ) {
        return part;
      }

      return { ...part, text: replaceText(part.text) };
    }),
    referencedIds,
  };
};

export interface ContextSelectionsInjectorConfig {
  /** Whether generic contextSelections injection is enabled */
  enabled?: boolean;
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
    _isLastUser: boolean,
  ): { content: string; contextType: string } | null {
    if (!this.config.enabled) {
      return null;
    }

    const contextSelections = message.metadata?.contextSelections as ContextSelection[] | undefined;

    if (!contextSelections || contextSelections.length === 0) {
      return null;
    }

    const formattedSelections = formatContextSelections(contextSelections);
    if (!formattedSelections) return null;

    log(
      `Building generic context selections for message at index ${index} with ${contextSelections.length} selections`,
    );

    return {
      content: formattedSelections,
      contextType: 'user_context_selections',
    };
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    if (!this.config.enabled) return super.doProcess(context);

    const clonedContext = this.cloneContext(context);
    const messages = clonedContext.messages.map((message) => {
      const contextSelections = message.metadata?.contextSelections as
        ContextSelection[] | undefined;
      if (!contextSelections || contextSelections.length === 0) return message;

      const { content, referencedIds } = replaceInlineContextReferences(
        message.content,
        contextSelections,
      );

      if (referencedIds.size === 0) return message;

      return {
        ...message,
        content,
        metadata: {
          ...message.metadata,
          contextSelections: contextSelections.filter(({ id }) => !referencedIds.has(id)),
        },
      };
    });

    return super.doProcess({ ...clonedContext, messages });
  }
}
