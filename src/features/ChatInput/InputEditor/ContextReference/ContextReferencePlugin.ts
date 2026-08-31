import { $wrapNodeInElement } from '@lexical/utils';
import type { ChatContextContent } from '@lobechat/types';
import { CONTEXT_REFERENCE_NODE_TYPE, createContextReferenceMarker } from '@lobechat/types';
import { type getKernelFromEditor, IMarkdownShortCutService } from '@lobehub/editor';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $insertNodes,
  $isRootOrShadowRoot,
  COMMAND_PRIORITY_HIGH,
  createCommand,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical';

import {
  $createContextReferenceNode,
  $isContextReferenceNode,
  ContextReferenceNode,
} from './ContextReferenceNode';

export interface InsertContextReferencePayload {
  selection: ChatContextContent;
}

export const INSERT_CONTEXT_REFERENCE_COMMAND = createCommand<InsertContextReferencePayload>(
  'INSERT_CONTEXT_REFERENCE_COMMAND',
);

type IEditorKernel = ReturnType<typeof getKernelFromEditor>;

export interface ContextReferencePluginOptions {
  decorator: (node: ContextReferenceNode, editor: LexicalEditor) => any;
  theme?: { contextReference?: string };
}

export class ContextReferencePlugin {
  static pluginName = 'ContextReferencePlugin';

  config?: ContextReferencePluginOptions;
  private kernel: IEditorKernel;

  constructor(kernel: IEditorKernel, config?: ContextReferencePluginOptions) {
    this.kernel = kernel;
    this.config = config;

    kernel.registerNodes([ContextReferenceNode]);
    if (config?.theme) kernel.registerThemes(config.theme);

    kernel.registerDecorator(ContextReferenceNode.getType(), (node, editor) =>
      config?.decorator ? config.decorator(node as ContextReferenceNode, editor) : null,
    );
  }

  onInit(editor: LexicalEditor): void {
    this.registerMarkdown();
    this.registerCommand(editor);
  }

  private registerMarkdown(): void {
    const mdService = this.kernel.requireService(IMarkdownShortCutService);

    mdService?.registerMarkdownWriter(
      CONTEXT_REFERENCE_NODE_TYPE,
      (ctx: { appendLine: (line: string) => void }, node: LexicalNode) => {
        if ($isContextReferenceNode(node)) {
          ctx.appendLine(createContextReferenceMarker(node.selection.id));
        }
      },
    );
  }

  private registerCommand(editor: LexicalEditor): void {
    editor.registerCommand(
      INSERT_CONTEXT_REFERENCE_COMMAND,
      (payload) => {
        editor.update(() => {
          if (!$getSelection()) $getRoot().selectEnd();

          const node = $createContextReferenceNode(payload.selection);
          $insertNodes([node, $createTextNode(' ')]);
          if ($isRootOrShadowRoot(node.getParentOrThrow())) {
            $wrapNodeInElement(node, $createParagraphNode).selectEnd();
          }
        });
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }

  destroy(): void {
    this.kernel.unregisterDecorator?.(ContextReferenceNode.getType());
  }
}
