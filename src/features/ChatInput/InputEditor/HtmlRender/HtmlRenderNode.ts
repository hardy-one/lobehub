import { addClassNamesToElement } from '@lexical/utils';
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

import HtmlRenderEditor from './HtmlRenderEditor';

export type SerializedHtmlRenderNode = Spread<
  {
    html: string;
  },
  SerializedLexicalNode
>;

export class HtmlRenderNode extends DecoratorNode<any> implements HeadlessRenderableNode {
  __html: string;

  static getType(): string {
    return 'html-render';
  }

  static clone(node: HtmlRenderNode): HtmlRenderNode {
    return new HtmlRenderNode(node.__html, node.__key);
  }

  static importJSON(serializedNode: SerializedHtmlRenderNode): HtmlRenderNode {
    return $createHtmlRenderNode(serializedNode.html).updateFromJSON(serializedNode);
  }

  static importDOM(): null {
    return null;
  }

  constructor(html: string, key?: string) {
    super(key);
    this.__html = html;
  }

  get html(): string {
    return this.__html;
  }

  setHtml(html: string): void {
    const self = this.getWritable();
    self.__html = html;
  }

  exportDOM(): DOMExportOutput {
    return { element: document.createElement('div') };
  }

  createDOM(config: EditorConfig): HTMLElement {
    const element = document.createElement('div');
    addClassNamesToElement(element, config.theme.htmlRender);
    return element;
  }

  getTextContent(): string {
    return this.__html;
  }

  updateDOM(): boolean {
    return false;
  }

  exportJSON(): SerializedHtmlRenderNode {
    return {
      ...super.exportJSON(),
      html: this.__html,
    };
  }

  updateFromJSON(serializedNode: LexicalUpdateJSON<SerializedHtmlRenderNode>): this {
    return super.updateFromJSON(serializedNode);
  }

  decorate(editor: LexicalEditor): any {
    const decorator = getKernelFromEditor(editor)?.getDecorator(HtmlRenderNode.getType());
    if (!decorator) return null;
    if (typeof decorator === 'function') return decorator(this, editor);
    return {
      queryDOM: decorator.queryDOM,
      render: decorator.render(this, editor),
    };
  }

  renderHeadless({ key }: HeadlessRenderContext) {
    return createElement(HtmlRenderEditor, {
      html: this.__html,
      id: key,
      key,
    });
  }
}

export function $createHtmlRenderNode(html: string): HtmlRenderNode {
  return $applyNodeReplacement(new HtmlRenderNode(html));
}

export function $isHtmlRenderNode(node: LexicalNode | null | undefined): node is HtmlRenderNode {
  return node instanceof HtmlRenderNode;
}
