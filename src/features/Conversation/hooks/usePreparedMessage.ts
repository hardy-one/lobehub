import { useMemo } from 'react';

import { normalizeThinkTags, processWithArtifact } from '@/features/Conversation/utils/markdown';

/**
 * Message text after the artifact / think-tag rewriting.
 *
 * The two passes rewrite the whole message: six `String.replace` calls, two of
 * them lazily spanning the document, plus newline normalization. Running them
 * in a render body charged the full text on every re-render, and a streaming
 * reply re-renders many times a second. The result depends only on `content`,
 * so it is cached per content string.
 */
export const usePreparedMessage = (content: string): string =>
  useMemo(() => normalizeThinkTags(processWithArtifact(content)), [content]);
