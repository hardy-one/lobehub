import {
  appendTextWindowNotice,
  sliceTextWindow,
  type TextWindow,
} from '@lobechat/prompts/textWindow';

import type {
  ReadDocumentArgs,
  ReadDocumentContinuation,
  ReadDocumentRange,
  ReadDocumentState,
} from '../types';
import { MAX_READ_DOCUMENT_CONTENT_CHARS } from '../types';

interface ReadableDocument {
  content?: string;
  id: string;
  litexml?: string;
  title?: string;
}

interface FormattedWindow {
  content: string;
  continuation?: ReadDocumentContinuation;
  range: ReadDocumentRange;
  truncated: boolean;
}

const lineStarts = (content: string): number[] => {
  const starts = [0];
  for (let index = 0; index < content.length; index++) {
    if (content[index] === '\n') starts.push(index + 1);
  }
  return starts;
};

const toRange = (content: string, window: TextWindow): ReadDocumentRange => {
  const starts = lineStarts(content);
  const startOffset = starts[window.startLine - 1] ?? content.length;

  return {
    endLine: window.endLine,
    endOffset: startOffset + window.content.length,
    length: window.content.length,
    startLine: window.startLine,
    startOffset,
    totalLength: window.totalChars,
    totalLines: window.totalLines,
  };
};

const readWindow = (
  content: string,
  args: ReadDocumentArgs,
  format: ReadDocumentContinuation['format'],
): FormattedWindow => {
  const paged = args.offset !== undefined || args.limit !== undefined;
  const window =
    paged || content.length > MAX_READ_DOCUMENT_CONTENT_CHARS
      ? sliceTextWindow(content, {
          maxChars: MAX_READ_DOCUMENT_CONTENT_CHARS,
          maxLines: args.limit,
          offset: args.offset,
        })
      : sliceTextWindow(content);
  const continuation: ReadDocumentContinuation | undefined = window.truncated
    ? {
        format,
        id: args.id,
        ...(args.limit !== undefined && { limit: args.limit }),
        offset: window.endLine + 1,
      }
    : undefined;

  return {
    content: appendTextWindowNotice(window, {
      continueFrom: (line) =>
        `call readDocument again with id="${args.id}", format="${format}" and offset=${line}`,
    }),
    ...(continuation && { continuation }),
    range: toRange(content, window),
    truncated: window.truncated,
  };
};

export interface FormattedDocumentRead {
  content: string;
  state: ReadDocumentState;
}

/**
 * Keep the next-branch line-based read window while exposing the on-demand
 * mode's explicit continuation and range state for the Inspector.
 */
export const formatDocumentReadContent = (
  doc: ReadableDocument,
  args: ReadDocumentArgs,
): FormattedDocumentRead => {
  const markdown = doc.content || '';
  const xml = doc.litexml || '';
  const requestedFormat = args.format ?? 'xml';
  const state: ReadDocumentState = {
    content: markdown,
    id: doc.id,
    title: doc.title,
    xml,
  };

  if (requestedFormat === 'both') {
    const markdownWindow = readWindow(markdown, args, 'markdown');
    const xmlWindow = readWindow(xml, args, 'xml');
    const primaryWindow = xml.length > 0 ? xmlWindow : markdownWindow;
    const continuations = {
      ...(markdownWindow.continuation && { markdown: markdownWindow.continuation }),
      ...(xmlWindow.continuation && { xml: xmlWindow.continuation }),
    };
    const ranges = {
      markdown: markdownWindow.range,
      xml: xmlWindow.range,
    };

    return {
      content: JSON.stringify({
        markdown: markdownWindow.content,
        xml: xmlWindow.content,
      }),
      state: {
        ...state,
        ...(primaryWindow.continuation && { continuation: primaryWindow.continuation }),
        ...(Object.keys(continuations).length > 0 && { continuations }),
        format: 'both',
        hasMore: markdownWindow.truncated || xmlWindow.truncated,
        ...(primaryWindow.continuation && { nextOffset: primaryWindow.continuation.offset }),
        range: primaryWindow.range,
        ranges,
      },
    };
  }

  const actualFormat =
    requestedFormat === 'markdown' || !xml ? 'markdown' : ('xml' as 'markdown' | 'xml');
  const window = readWindow(actualFormat === 'markdown' ? markdown : xml, args, actualFormat);

  return {
    content: window.content,
    state: {
      ...state,
      ...(window.continuation && { continuation: window.continuation }),
      format: actualFormat,
      hasMore: window.truncated,
      ...(window.continuation && { nextOffset: window.continuation.offset }),
      range: window.range,
    },
  };
};
