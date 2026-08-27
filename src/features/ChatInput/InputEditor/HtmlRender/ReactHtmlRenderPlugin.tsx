'use client';

import { useLexicalComposerContext } from '@lobehub/editor';
import { type FC, useLayoutEffect } from 'react';

import HtmlRenderEditor from './HtmlRenderEditor';
import { type HtmlRenderNode } from './HtmlRenderNode';
import { HtmlRenderPlugin } from './HtmlRenderPlugin';

const ReactHtmlRenderPlugin: FC = () => {
  const [editor] = useLexicalComposerContext();

  useLayoutEffect(() => {
    editor.registerPlugin(HtmlRenderPlugin, {
      decorator: (node: HtmlRenderNode, lexicalEditor) => {
        return (
          <HtmlRenderEditor
            editor={lexicalEditor}
            html={node.html}
            id={node.getKey()}
            node={node}
          />
        );
      },
    });
  }, [editor]);

  return null;
};

ReactHtmlRenderPlugin.displayName = 'ReactHtmlRenderPlugin';

export default ReactHtmlRenderPlugin;
