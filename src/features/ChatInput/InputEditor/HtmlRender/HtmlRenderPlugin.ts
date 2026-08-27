import { HTML_RENDER_END_MARKER, HTML_RENDER_START_MARKER } from '@lobechat/const';
import { type getKernelFromEditor, IMarkdownShortCutService } from '@lobehub/editor';
import { type LexicalEditor, type LexicalNode } from 'lexical';

import { $createHtmlRenderNode, $isHtmlRenderNode, HtmlRenderNode } from './HtmlRenderNode';

type IEditorKernel = ReturnType<typeof getKernelFromEditor>;

export interface HtmlRenderPluginOptions {
  decorator: (node: HtmlRenderNode, editor: LexicalEditor) => any;
  theme?: { htmlRender?: string };
}

/**
 * Owns the `html-render` block node in the Lexical editor:
 * - registers the decorator used to render the HTML-Render card
 * - serializes the node back to `<!-- html-render-start -->...<!-- html-render-end -->`
 * - reads the editor-internal fenced `html-render` code block back into the node
 *
 * The fenced-code form is only an internal transport: the chat/message wire
 * format stays the original HTML comments, and the markdown writer below
 * restores it on save.
 */
export class HtmlRenderPlugin {
  static pluginName = 'HtmlRenderPlugin';

  config?: HtmlRenderPluginOptions;
  private kernel: IEditorKernel;

  constructor(kernel: IEditorKernel, config?: HtmlRenderPluginOptions) {
    this.kernel = kernel;
    this.config = config;

    kernel.registerNodes([HtmlRenderNode]);

    if (config?.theme) {
      kernel.registerThemes(config.theme);
    }

    kernel.registerDecorator(
      HtmlRenderNode.getType(),
      (node: LexicalNode, editor: LexicalEditor) => {
        return config?.decorator ? config.decorator(node as HtmlRenderNode, editor) : null;
      },
    );
  }

  onInit(_editor: LexicalEditor): void {
    this.registerMarkdown();
  }

  private registerMarkdown(): void {
    const mdService = this.kernel.requireService(IMarkdownShortCutService);

    mdService?.registerMarkdownWriter(HtmlRenderNode.getType(), (ctx: any, node: any) => {
      if (!$isHtmlRenderNode(node)) return false;

      const html = node.html.trim();
      ctx.appendLine(HTML_RENDER_START_MARKER + '\n');
      ctx.appendLine(html + '\n');
      ctx.appendLine(HTML_RENDER_END_MARKER + '\n\n');
      return true;
    });

    mdService?.registerMarkdownReader(
      'code',
      (node: any) => {
        if (node.lang !== 'html-render') return false;

        return {
          children: [],
          direction: 'ltr',
          format: '',
          html: String(node.value ?? ''),
          indent: 0,
          type: HtmlRenderNode.getType(),
          version: 1,
        } as any;
      },
      1,
    );
  }

  destroy(): void {
    this.kernel.unregisterDecorator?.(HtmlRenderNode.getType());
  }
}

export { $createHtmlRenderNode, $isHtmlRenderNode, HtmlRenderNode };
