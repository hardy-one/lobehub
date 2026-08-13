import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import { describe, expect, it } from 'vitest';

import { rehypeRawText } from './rehypeRawText';

const cardFooter = `<!-- 底部栏 -->

<div class="card-footer">
<!-- 左侧：作者信息 -->
<div class="card-author">
  <div class="card-avatar">H</div>
  <div>
    <div class="card-author-name">Hardy</div>
    <div class="card-author-date">2026-08-15</div>
  </div>
</div>
<!-- 右侧：按钮 -->
<button class="card-button">阅读更多</button>`;

describe('rehypeRawText', () => {
  it('wraps root-level raw HTML blocks in pre-line divs while keeping newlines', () => {
    const tree = {
      children: [{ type: 'raw', value: cardFooter }],
      type: 'root',
    };

    rehypeRawText()(tree);

    expect(tree.children).toEqual([
      {
        children: [{ type: 'text', value: cardFooter }],
        properties: { style: 'white-space:pre-line' },
        tagName: 'div',
        type: 'element',
      },
    ]);
  });

  it('wraps inline raw HTML in a pre-line span', () => {
    const tree = {
      children: [
        {
          children: [
            { type: 'text', value: 'before ' },
            { type: 'raw', value: '<span class="x">inline</span>' },
          ],
          tagName: 'p',
          type: 'element',
        },
      ],
      type: 'root',
    };

    rehypeRawText()(tree);

    const paragraph = tree.children[0] as any;
    expect(paragraph.children[1]).toEqual({
      children: [{ type: 'text', value: '<span class="x">inline</span>' }],
      properties: { style: 'white-space:pre-line' },
      tagName: 'span',
      type: 'element',
    });
  });

  it('leaves trees without raw nodes untouched', () => {
    const tree = {
      children: [{ children: [{ type: 'text', value: 'plain text' }], type: 'paragraph' }],
      type: 'root',
    };

    const snapshot = structuredClone(tree);
    rehypeRawText()(tree);

    expect(tree).toEqual(snapshot);
  });

  it('keeps the original line breaks when react-markdown falls back to literal HTML text', () => {
    const html = renderToStaticMarkup(
      <Markdown rehypePlugins={[rehypeRawText]}>{cardFooter}</Markdown>,
    );

    expect(html).toContain('style="white-space:pre-line"');
    expect(html).toContain('&lt;!-- 底部栏 --&gt;');
    expect(html).toContain(
      '&lt;div class=&quot;card-footer&quot;&gt;\n&lt;!-- 左侧：作者信息 --&gt;',
    );
  });
});
