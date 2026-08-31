import { addClassNamesToElement } from '@lexical/utils';
import type { ChatContextContent } from '@lobechat/types';
import { CONTEXT_REFERENCE_NODE_TYPE } from '@lobechat/types';
import { getKernelFromEditor } from '@lobehub/editor';
import type { HeadlessRenderableNode, HeadlessRenderContext } from '@lobehub/editor/renderer';
import {
  $applyNodeReplacement,
  DecoratorNode,
  type DOMExportOutput,
  type EditorConfig,
  type LexicalEditor,
  type LexicalNode,
  type LexicalUpdateJSON,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical';
import { createElement } from 'react';

import { ContextReference } from './ContextReference';

export type SerializedContextReferenceNode = Spread<
  {
    selection: ChatContextContent;
  },
  SerializedLexicalNode
>;

export class ContextReferenceNode extends DecoratorNode<any> implements HeadlessRenderableNode {
  __selection: ChatContextContent;

  static getType(): string {
    return CONTEXT_REFERENCE_NODE_TYPE;
  }

  static clone(node: ContextReferenceNode): ContextReferenceNode {
    return new ContextReferenceNode(node.__selection, node.__key);
  }

  static importJSON(serializedNode: SerializedContextReferenceNode): ContextReferenceNode {
    return $createContextReferenceNode(serializedNode.selection).updateFromJSON(serializedNode);
  }

  static importDOM(): null {
    return null;
  }

  constructor(selection: ChatContextContent, key?: string) {
    super(key);
    this.__selection = selection;
  }

  get selection(): ChatContextContent {
    return this.__selection;
  }

  exportDOM(): DOMExportOutput {
    return { element: document.createElement('span') };
  }

  createDOM(config: EditorConfig): HTMLElement {
    const element = document.createElement('span');
    addClassNamesToElement(element, config.theme.contextReference);
    return element;
  }

  getTextContent(): string {
    return this.__selection.title || this.__selection.preview || this.__selection.content;
  }

  isInline(): true {
    return true;
  }

  updateDOM(): boolean {
    return false;
  }

  exportJSON(): SerializedContextReferenceNode {
    return {
      ...super.exportJSON(),
      selection: this.__selection,
    };
  }

  updateFromJSON(serializedNode: LexicalUpdateJSON<SerializedContextReferenceNode>): this {
    return super.updateFromJSON(serializedNode);
  }

  decorate(editor: LexicalEditor): any {
    const decorator = getKernelFromEditor(editor)?.getDecorator(ContextReferenceNode.getType());
    if (!decorator) return null;
    if (typeof decorator === 'function') return decorator(this, editor);
    return {
      queryDOM: decorator.queryDOM,
      render: decorator.render(this, editor),
    };
  }

  renderHeadless({ key }: HeadlessRenderContext) {
    return createElement(ContextReference, {
      key,
      selection: this.__selection,
    });
  }
}

export function $createContextReferenceNode(selection: ChatContextContent): ContextReferenceNode {
  return $applyNodeReplacement(new ContextReferenceNode(selection));
}

export function $isContextReferenceNode(
  node: LexicalNode | null | undefined,
): node is ContextReferenceNode {
  return node?.getType() === ContextReferenceNode.getType();
}
