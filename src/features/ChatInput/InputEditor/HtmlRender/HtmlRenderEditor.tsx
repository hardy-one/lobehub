'use client';

import { type LexicalEditor } from 'lexical';
import { memo, useCallback } from 'react';

import Render from '@/features/Conversation/Markdown/plugins/HtmlRender/Render';

import { type HtmlRenderNode } from './HtmlRenderNode';

interface HtmlRenderEditorProps {
  editor?: LexicalEditor;
  html: string;
  id: string;
  node?: HtmlRenderNode;
}

const HtmlRenderEditor = memo<HtmlRenderEditorProps>(({ editor, html, id, node }) => {
  const handleSourceChange = useCallback(
    (nextHtml: string) => {
      if (node && editor) {
        editor.update(() => {
          node.setHtml(nextHtml);
        });
      }
    },
    [editor, node],
  );

  const handleDelete = useCallback(() => {
    if (node && editor) {
      editor.update(() => {
        node.remove();
      });
    }
  }, [editor, node]);

  return (
    <Render
      editable={!!node && !!editor}
      id={id}
      node={{ properties: {} }}
      open={false}
      streaming={false}
      tagName={'html-render'}
      type={'htmlRenderBlock'}
      onDelete={handleDelete}
      onSourceChange={handleSourceChange}
    >
      {html}
    </Render>
  );
});

HtmlRenderEditor.displayName = 'HtmlRenderEditor';

export default HtmlRenderEditor;
