/* eslint-disable @typescript-eslint/consistent-type-imports */
import type { HeadlessLiteXMLOperation } from '@lobehub/editor/headless';
import { type SerializedEditorState, type SerializedLexicalNode, type NodeKey, $applyNodeReplacement, DecoratorNode } from 'lexical';

import { EMPTY_EDITOR_STATE } from '@/libs/editor/constants';
import { isValidEditorData } from '@/libs/editor/isValidEditorData';

export type AgentDocumentEditorData = Record<string, any>;

export type AgentDocumentLiteXMLOperation =
  | {
      action: 'insert';
      afterId: string;
      litexml: string;
    }
  | {
      action: 'insert';
      beforeId: string;
      litexml: string;
    }
  | {
      action: 'modify';
      litexml: string | string[];
    }
  | {
      action: 'remove';
      id: string;
    };

const orderLiteXMLOperations = (
  operations: AgentDocumentLiteXMLOperation[],
): AgentDocumentLiteXMLOperation[] => {
  const orderedOperations: AgentDocumentLiteXMLOperation[] = [];

  for (const operation of operations) {
    if (operation.action === 'insert') {
      orderedOperations.unshift(operation);
    } else {
      orderedOperations.push(operation);
    }
  }

  return orderedOperations;
};

const toHeadlessLiteXMLOperation = (
  operation: AgentDocumentLiteXMLOperation,
): HeadlessLiteXMLOperation => {
  switch (operation.action) {
    case 'insert': {
      return 'beforeId' in operation
        ? {
            action: 'insert',
            beforeId: operation.beforeId,
            delay: true,
            litexml: operation.litexml,
          }
        : {
            action: 'insert',
            afterId: operation.afterId,
            delay: true,
            litexml: operation.litexml,
          };
    }

    case 'modify': {
      return {
        action: 'replace',
        delay: true,
        litexml: operation.litexml,
      };
    }

    case 'remove': {
      return {
        action: 'remove',
        delay: true,
        id: operation.id,
      };
    }
  }
};

export interface AgentDocumentEditorSnapshot {
  content: string;
  editorData: AgentDocumentEditorData;
  litexml?: string;
}

interface LoadEditorStateParams {
  editorData?: AgentDocumentEditorData | null;
  fallbackContent?: string;
}

const exportSnapshot = (
  editor: ReturnType<(typeof import('@lobehub/editor/headless'))['createHeadlessEditor']>,
  litexml = false,
): AgentDocumentEditorSnapshot => {
  const snapshot = editor.export({ litexml });

  return {
    content: snapshot.markdown,
    editorData: snapshot.editorData as SerializedEditorState<SerializedLexicalNode>,
    litexml: snapshot.litexml,
  };
};

const hydrateMarkdownOrEmptyState = (
  editor: ReturnType<(typeof import('@lobehub/editor/headless'))['createHeadlessEditor']>,
  content: string,
  options?: { keepId?: boolean },
) => {
  if (content.trim().length === 0) {
    editor.hydrateEditorData(
      EMPTY_EDITOR_STATE as unknown as SerializedEditorState<SerializedLexicalNode>,
      options,
    );
    return;
  }

  editor.hydrateMarkdown(content, options);
};

const loadEditorState = (
  editor: ReturnType<(typeof import('@lobehub/editor/headless'))['createHeadlessEditor']>,
  { editorData, fallbackContent = '' }: LoadEditorStateParams,
) => {
  if (isValidEditorData(editorData)) {
    try {
      editor.hydrateEditorData(
        editorData as unknown as SerializedEditorState<SerializedLexicalNode>,
        {
          keepId: true,
        },
      );
      return;
    } catch (err) {
      console.warn(
        '[headlessEditor] hydrateEditorData failed, falling back to markdown:',
        (err as Error).message,
      );
    }
  }

  hydrateMarkdownOrEmptyState(editor, fallbackContent, { keepId: true });
};

interface SerializedBlockImageNode extends SerializedLexicalNode {
  altText: string;
  height: number;
  maxWidth: number;
  src: string;
  width: number;
  status?: string;
}

/**
 * Minimal stub that satisfies Lexical's `parseEditorState` for documents
 * containing "block-image" nodes. The real BlockImageNode is a DecoratorNode
 * exported internally by @lobehub/editor but importing that package in
 * Node.js pulls in React modules that crash with `document is not defined`.
 *
 * This stub only implements the deserialization/serialization interface
 * needed by the headless editor's hydrate/export cycle.
 */
class StubBlockImageNode extends DecoratorNode<unknown> {
  __altText: string;
  __height: number;
  __maxWidth: number;
  __src: string;
  __width: number;
  __status?: string;

  constructor(
    { altText, height, maxWidth, src, width, status, key }: Partial<SerializedBlockImageNode> & { key?: NodeKey },
  ) {
    super(key);
    this.__altText = altText ?? '';
    this.__height = height ?? 0;
    this.__maxWidth = maxWidth ?? 4200;
    this.__src = src ?? '';
    this.__width = width ?? 0;
    this.__status = status;
  }

  static getType(): string { return 'block-image'; }

  static clone(node: StubBlockImageNode): StubBlockImageNode {
    return new StubBlockImageNode({
      altText: node.__altText,
      height: node.__height,
      maxWidth: node.__maxWidth,
      src: node.__src,
      width: node.__width,
      status: node.__status,
      key: node.__key,
    });
  }

  static importJSON(serializedNode: SerializedBlockImageNode): StubBlockImageNode {
    const node = $applyNodeReplacement(
      new StubBlockImageNode({
        altText: serializedNode.altText,
        height: serializedNode.height,
        maxWidth: serializedNode.maxWidth,
        src: serializedNode.src,
        width: serializedNode.width,
        status: serializedNode.status,
      }),
    );
    return node;
  }

  exportJSON(): SerializedBlockImageNode {
    return {
      altText: this.__altText,
      height: this.__height,
      maxWidth: this.__maxWidth,
      src: this.__src,
      type: 'block-image',
      version: 1,
      width: this.__width,
    };
  }

  createDOM(): HTMLElement { return document.createElement('div'); }

  decorate(): unknown { return null; }

  isInline(): boolean { return false; }
}

const createHeadlessEditorWithNodes = async () => {
  const [{ createHeadlessEditor }, { LinkNode, AutoLinkNode }] = await Promise.all([
    import('@lobehub/editor/headless'),
    import('@lexical/link'),
  ]);

  const editor = createHeadlessEditor();
  if ('kernel' in editor) {
    const kernel = editor.kernel as any;
    kernel.registerNodes([LinkNode, AutoLinkNode]);

    const lexicalEditor = kernel.editor;
    if (lexicalEditor?._nodes) {
      const existing = lexicalEditor._nodes.get(StubBlockImageNode.getType());
      if (!existing) {
        lexicalEditor._nodes.set(StubBlockImageNode.getType(), {
          klass: StubBlockImageNode,
          replace: null,
          replaceWithKlass: null,
          type: 'node',
        });
      }
    }
  }
  return editor;
};

export const createMarkdownEditorSnapshot = async (
  content: string,
): Promise<AgentDocumentEditorSnapshot> => {
  const editor = await createHeadlessEditorWithNodes();

  try {
    hydrateMarkdownOrEmptyState(editor, content);
    return exportSnapshot(editor);
  } finally {
    editor.destroy();
  }
};

export const exportEditorDataSnapshot = async (
  params: LoadEditorStateParams & { litexml?: boolean },
): Promise<AgentDocumentEditorSnapshot> => {
  const editor = await createHeadlessEditorWithNodes();

  try {
    loadEditorState(editor, params);
    return exportSnapshot(editor, params.litexml);
  } finally {
    editor.destroy();
  }
};

export const applyLiteXMLOperations = async ({
  editorData,
  fallbackContent,
  operations,
}: LoadEditorStateParams & {
  operations: AgentDocumentLiteXMLOperation[];
}): Promise<AgentDocumentEditorSnapshot> => {
  const editor = await createHeadlessEditorWithNodes();

  try {
    loadEditorState(editor, { editorData, fallbackContent });
    await editor.applyLiteXML(orderLiteXMLOperations(operations).map(toHeadlessLiteXMLOperation));
    return exportSnapshot(editor, true);
  } finally {
    editor.destroy();
  }
};
