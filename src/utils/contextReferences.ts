import type { ChatContextContent } from '@lobechat/types';
import { CONTEXT_REFERENCE_NODE_TYPE } from '@lobechat/types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isChatContextContent = (value: unknown): value is ChatContextContent => {
  if (!isRecord(value)) return false;

  return (
    typeof value.content === 'string' &&
    typeof value.id === 'string' &&
    typeof value.type === 'string'
  );
};

/** Extract context-reference payloads in their Lexical document order. */
export const extractContextReferences = (editorData: unknown): ChatContextContent[] => {
  const references: ChatContextContent[] = [];

  const visit = (node: unknown): void => {
    if (!isRecord(node)) return;

    if (node.type === CONTEXT_REFERENCE_NODE_TYPE && isChatContextContent(node.selection)) {
      references.push(node.selection);
    }

    if (Array.isArray(node.children)) {
      node.children.forEach(visit);
    }
  };

  const root = isRecord(editorData) && isRecord(editorData.root) ? editorData.root : editorData;
  visit(root);
  return references;
};

/** Merge external and inline context lists without sending the same id twice. */
export const mergeContextReferences = (...groups: ChatContextContent[][]): ChatContextContent[] => {
  const seen = new Set<string>();

  return groups.flatMap((group) =>
    group.filter((selection) => {
      if (seen.has(selection.id)) return false;
      seen.add(selection.id);
      return true;
    }),
  );
};
