import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { describe, expect, it } from 'vitest';

import {
  HTML_RENDER_END_MARKER,
  HTML_RENDER_START_MARKER,
  remarkHtmlRender,
} from './remarkHtmlRender';

const processMarkdown = (markdown: string) => {
  const processor = unified().use(remarkParse).use(remarkHtmlRender);
  const tree = processor.parse(markdown);
  return processor.runSync(tree);
};

const collectNodesByType = (tree: any, type: string) => {
  const nodes: any[] = [];
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === type) nodes.push(node);
    const children = (node as any).children;
    if (Array.isArray(children)) for (const child of children) walk(child);
  };
  walk(tree);
  return nodes;
};

describe('remarkHtmlRender', () => {
  it('should extract a closed fragment without blank lines (end marker swallowed into the html block)', () => {
    const markdown = [
      'Before',
      '',
      HTML_RENDER_START_MARKER,
      '<div style="color:red">卡片</div>',
      HTML_RENDER_END_MARKER,
      '',
      'After',
    ].join('\n');

    const tree = processMarkdown(markdown);

    const nodes = collectNodesByType(tree, 'htmlRenderBlock');
    expect(nodes).toHaveLength(1);
    const node = nodes[0];
    expect(node.data?.hName).toBe('html-render');
    expect(node.data?.hProperties).toEqual({ open: false });
    expect(node.data?.hChildren[0].value).toBe('<div style="color:red">卡片</div>');
  });

  it('should extract a closed fragment with blank lines around the fragment', () => {
    const markdown = [
      HTML_RENDER_START_MARKER,
      '',
      '<div>卡片</div>',
      '',
      HTML_RENDER_END_MARKER,
    ].join('\n');

    const tree = processMarkdown(markdown);

    const nodes = collectNodesByType(tree, 'htmlRenderBlock');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].data?.hChildren[0].value).toBe('<div>卡片</div>');
  });

  it('should mark an unclosed fragment as open with the partial content', () => {
    const markdown = [HTML_RENDER_START_MARKER, '<div style="color:red">卡片'].join('\n');

    const tree = processMarkdown(markdown);

    const nodes = collectNodesByType(tree, 'htmlRenderBlock');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].data?.hProperties).toEqual({ open: true });
    expect(nodes[0].data?.hChildren[0].value).toBe('<div style="color:red">卡片');
  });

  it('should leave an unclosed fragment untouched while the content is too short', () => {
    const markdown = [HTML_RENDER_START_MARKER, '<div>'].join('\n');

    const tree = processMarkdown(markdown);

    expect(collectNodesByType(tree, 'htmlRenderBlock')).toHaveLength(0);
  });

  it('should leave a closed but empty fragment untouched', () => {
    const markdown = [HTML_RENDER_START_MARKER, HTML_RENDER_END_MARKER].join('\n');

    const tree = processMarkdown(markdown);

    expect(collectNodesByType(tree, 'htmlRenderBlock')).toHaveLength(0);
  });

  it('should stop collecting when the fragment is interrupted by markdown structure', () => {
    const markdown = [
      HTML_RENDER_START_MARKER,
      '<div>部分内容</div>',
      '',
      '这是一段普通 markdown',
    ].join('\n');

    const tree = processMarkdown(markdown);

    const nodes = collectNodesByType(tree, 'htmlRenderBlock');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].data?.hProperties).toEqual({ open: true });
    expect(nodes[0].data?.hChildren[0].value).toBe('<div>部分内容</div>');
  });

  it('should leave markdown without markers untouched', () => {
    const markdown = '# 标题\n\n普通 **markdown** 内容';

    const tree = processMarkdown(markdown);

    expect(collectNodesByType(tree, 'htmlRenderBlock')).toHaveLength(0);
    expect((tree as any).children).toHaveLength(2);
  });

  it('should handle multiple fragments in one message', () => {
    const markdown = [
      HTML_RENDER_START_MARKER,
      '<div>A</div>',
      HTML_RENDER_END_MARKER,
      '',
      HTML_RENDER_START_MARKER,
      '<div>B</div>',
      HTML_RENDER_END_MARKER,
    ].join('\n');

    const tree = processMarkdown(markdown);

    const nodes = collectNodesByType(tree, 'htmlRenderBlock');
    expect(nodes).toHaveLength(2);
    expect(nodes.map((n) => n.data?.hChildren[0].value)).toEqual(['<div>A</div>', '<div>B</div>']);
  });

  it('should keep the text that follows the end marker inside the same html node', () => {
    // CommonMark swallows the end marker AND the trailing text into the same
    // HTML block when there is no blank line — the tail must survive.
    const markdown = [
      HTML_RENDER_START_MARKER,
      '<div>卡片</div>',
      `${HTML_RENDER_END_MARKER} 这是片段后的正文`,
    ].join('\n');

    const tree = processMarkdown(markdown);

    const nodes = collectNodesByType(tree, 'htmlRenderBlock');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].data?.hChildren[0].value).toBe('<div>卡片</div>');

    const textNodes = collectNodesByType(tree, 'text');
    const tailText = textNodes.map((n) => n.value).join('');
    expect(tailText).toContain('这是片段后的正文');
  });

  it('should keep the trailing markdown after an open fragment', () => {
    const markdown = [HTML_RENDER_START_MARKER, '<div>部分内容</div>', '', '正文继续'].join('\n');

    const tree = processMarkdown(markdown);

    const nodes = collectNodesByType(tree, 'htmlRenderBlock');
    expect(nodes).toHaveLength(1);
    // the following paragraph survives
    expect((tree as any).children.some((c: any) => c.type === 'paragraph')).toBe(true);
  });

  it('should render a fragment whose content parses as a plain-text paragraph', () => {
    const markdown = [HTML_RENDER_START_MARKER, '纯文本片段内容', HTML_RENDER_END_MARKER].join(
      '\n',
    );

    const tree = processMarkdown(markdown);

    const nodes = collectNodesByType(tree, 'htmlRenderBlock');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].data?.hChildren[0].value).toBe('纯文本片段内容');
  });

  it('should collect inline html/text inside a paragraph', () => {
    const markdown = [
      HTML_RENDER_START_MARKER,
      '这是 <b>加粗</b> 内容',
      HTML_RENDER_END_MARKER,
    ].join('\n');

    const tree = processMarkdown(markdown);

    const nodes = collectNodesByType(tree, 'htmlRenderBlock');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].data?.hChildren[0].value).toBe('这是 <b>加粗</b> 内容');
  });

  it('should still stop at non-collectible markdown structure', () => {
    const markdown = [HTML_RENDER_START_MARKER, '<div>部分内容</div>', '', '- 列表项'].join('\n');

    const tree = processMarkdown(markdown);

    const nodes = collectNodesByType(tree, 'htmlRenderBlock');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].data?.hProperties).toEqual({ open: true });
  });

  it('should not absorb a blank-line-separated html block into an open fragment', () => {
    const markdown = [
      HTML_RENDER_START_MARKER,
      '<div>片段内容</div>',
      '',
      '<div>独立正文块</div>',
    ].join('\n');

    const tree = processMarkdown(markdown);

    const nodes = collectNodesByType(tree, 'htmlRenderBlock');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].data?.hProperties).toEqual({ open: true });
    expect(nodes[0].data?.hChildren[0].value).toBe('<div>片段内容</div>');
    // the following block survives as its own html node
    expect(collectNodesByType(tree, 'html').some((n) => n.value.includes('独立正文块'))).toBe(true);
  });

  it('should keep collecting blank-line-separated blocks when the fragment closes', () => {
    const markdown = [
      HTML_RENDER_START_MARKER,
      '<div>A</div>',
      '',
      '<div>B</div>',
      HTML_RENDER_END_MARKER,
    ].join('\n');

    const tree = processMarkdown(markdown);

    const nodes = collectNodesByType(tree, 'htmlRenderBlock');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].data?.hProperties).toEqual({ open: false });
    // both blank-line-separated blocks are collected (block-level divs
    // still render as separate lines in the fragment)
    expect(nodes[0].data?.hChildren[0].value).toBe('<div>A</div><div>B</div>');
  });

  it('should close a fragment that contains a blank-line-separated markdown paragraph', () => {
    const markdown = [
      HTML_RENDER_START_MARKER,
      '<div>head</div>',
      '',
      '**重要说明**',
      '',
      HTML_RENDER_END_MARKER,
      'After',
    ].join('\n');

    const tree = processMarkdown(markdown);

    const nodes = collectNodesByType(tree, 'htmlRenderBlock');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].data?.hProperties).toEqual({ open: false });
    expect(nodes[0].data?.hChildren[0].value).toContain('<div>head</div>');
    // the markdown paragraph is preserved inside the fragment (flattened to text)
    expect(nodes[0].data?.hChildren[0].value).toContain('重要说明');
    // no orphaned end-marker node remains
    expect(collectNodesByType(tree, 'html').some((n) => n.value.includes('html-render-end'))).toBe(
      false,
    );
  });

  it('should not absorb a later closed fragment into an open fragment across a blank line', () => {
    const markdown = [
      HTML_RENDER_START_MARKER,
      '<div>A</div>',
      '',
      '<div>独立正文HTML</div>',
      '',
      HTML_RENDER_START_MARKER,
      '<div>C</div>',
      HTML_RENDER_END_MARKER,
    ].join('\n');

    const tree = processMarkdown(markdown);

    const nodes = collectNodesByType(tree, 'htmlRenderBlock');
    expect(nodes).toHaveLength(2);
    // fragment 1 stays open and only contains its own block
    expect(nodes[0].data?.hProperties).toEqual({ open: true });
    expect(nodes[0].data?.hChildren[0].value).toBe('<div>A</div>');
    // the independent block survives as its own html node
    expect(collectNodesByType(tree, 'html').some((n) => n.value.includes('独立正文HTML'))).toBe(
      true,
    );
    // fragment 2 is closed and intact
    expect(nodes[1].data?.hProperties).toEqual({ open: false });
    expect(nodes[1].data?.hChildren[0].value).toBe('<div>C</div>');
  });

  it('should not treat a literal end marker inside prose as a closure signal', () => {
    // The preset teaches the marker strings, so a model explaining the
    // protocol embeds the literal text in normal prose — an open fragment
    // must not absorb and truncate that content.
    const markdown = [
      HTML_RENDER_START_MARKER,
      '<div>openA</div>',
      '',
      'Normal markdown paragraph about the answer.',
      '',
      `This uses the ${HTML_RENDER_END_MARKER} protocol`,
    ].join('\n');

    const tree = processMarkdown(markdown);

    const nodes = collectNodesByType(tree, 'htmlRenderBlock');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].data?.hProperties).toEqual({ open: true });
    expect(nodes[0].data?.hChildren[0].value).toBe('<div>openA</div>');
    // both prose paragraphs survive as separate paragraphs
    expect(collectNodesByType(tree, 'paragraph')).toHaveLength(2);
  });

  it('should still close on a line-anchored end marker that shares a node with trailing text', () => {
    // CommonMark swallows the marker + trailing text into one html node when
    // there is no blank line — the tail must be preserved.
    const markdown = [
      HTML_RENDER_START_MARKER,
      `<div>A</div>\n${HTML_RENDER_END_MARKER} TRAIL`,
      '',
      'After',
    ].join('\n');

    const tree = processMarkdown(markdown);

    const nodes = collectNodesByType(tree, 'htmlRenderBlock');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].data?.hProperties).toEqual({ open: false });
    expect(nodes[0].data?.hChildren[0].value).toBe('<div>A</div>');
    const textNodes = collectNodesByType(tree, 'text')
      .map((n) => n.value)
      .join('');
    expect(textNodes).toContain('TRAIL');
    expect(textNodes).toContain('After');
  });

  it('should close on an indented end marker and keep the following content', () => {
    const markdown = [
      HTML_RENDER_START_MARKER,
      '<div>A</div>',
      `   ${HTML_RENDER_END_MARKER}`,
      '',
      'After',
    ].join('\n');

    const tree = processMarkdown(markdown);

    const nodes = collectNodesByType(tree, 'htmlRenderBlock');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].data?.hProperties).toEqual({ open: false });
    expect(nodes[0].data?.hChildren[0].value).toBe('<div>A</div>');
    // the following paragraph survives
    expect(collectNodesByType(tree, 'text').some((n) => n.value.includes('After'))).toBe(true);
  });

  it('should recognize an indented start marker', () => {
    const markdown = [
      `   ${HTML_RENDER_START_MARKER}`,
      '<div>A</div>',
      HTML_RENDER_END_MARKER,
    ].join('\n');

    const tree = processMarkdown(markdown);

    const nodes = collectNodesByType(tree, 'htmlRenderBlock');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].data?.hChildren[0].value).toBe('<div>A</div>');
  });

  it('should recognize a start marker that shares its line with content', () => {
    const markdown = [`${HTML_RENDER_START_MARKER}<div>A</div>`, HTML_RENDER_END_MARKER].join('\n');

    const tree = processMarkdown(markdown);

    const nodes = collectNodesByType(tree, 'htmlRenderBlock');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].data?.hProperties).toEqual({ open: false });
    expect(nodes[0].data?.hChildren[0].value).toBe('<div>A</div>');
  });

  it('should close a one-line fragment merged into a single html node', () => {
    // CommonMark merges the whole line into one html node; the end marker
    // inside the initial raw must close the fragment, not stay open forever.
    const markdown = `${HTML_RENDER_START_MARKER}<div>A</div>${HTML_RENDER_END_MARKER}`;

    const tree = processMarkdown(markdown);

    const nodes = collectNodesByType(tree, 'htmlRenderBlock');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].data?.hProperties).toEqual({ open: false });
    expect(nodes[0].data?.hChildren[0].value).toBe('<div>A</div>');
  });

  it('should not treat a literal end marker at the end of a prose paragraph as closure', () => {
    // The trailing-at-end acceptance applies only to the start node's
    // one-line content — a sibling paragraph ending with the literal marker
    // (e.g. explaining the protocol) must not close or truncate.
    const markdown = [
      HTML_RENDER_START_MARKER,
      '<div>openA</div>',
      '',
      `using the ${HTML_RENDER_END_MARKER}`,
    ].join('\n');

    const tree = processMarkdown(markdown);

    const nodes = collectNodesByType(tree, 'htmlRenderBlock');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].data?.hProperties).toEqual({ open: true });
    expect(nodes[0].data?.hChildren[0].value).toBe('<div>openA</div>');
    // the explaining paragraph survives intact (marker lives in its inline
    // html child, not a text node)
    expect(collectNodesByType(tree, 'html').some((n) => n.value.includes('html-render-end'))).toBe(
      true,
    );
  });

  it('should not absorb siblings after a one-line closed fragment', () => {
    // Once the initial raw closes the fragment, sibling collection must stop
    // — trailing content stays outside the card.
    const markdown = [
      `${HTML_RENDER_START_MARKER}<div>A</div>${HTML_RENDER_END_MARKER}`,
      '',
      'trailing prose',
    ].join('\n');

    const tree = processMarkdown(markdown);

    const nodes = collectNodesByType(tree, 'htmlRenderBlock');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].data?.hProperties).toEqual({ open: false });
    expect(nodes[0].data?.hChildren[0].value).toBe('<div>A</div>');
    expect(collectNodesByType(tree, 'text').some((n) => n.value.includes('trailing prose'))).toBe(
      true,
    );
  });

  it('should not treat inline marker comments inside prose as fragment boundaries', () => {
    // A model explaining the protocol writes the markers as their own inline
    // html nodes inside a paragraph — the sentence must survive intact.
    const markdown = `Use ${HTML_RENDER_START_MARKER} and ${HTML_RENDER_END_MARKER} to wrap HTML.`;

    const tree = processMarkdown(markdown);

    expect(collectNodesByType(tree, 'htmlRenderBlock')).toHaveLength(0);
    const text = collectNodesByType(tree, 'text')
      .map((n) => n.value)
      .join('');
    expect(text).toContain('Use ');
    expect(text).toContain(' and ');
    expect(text).toContain(' to wrap HTML.');
  });

  it('should not create a card from a root-level one-line prose marker pair', () => {
    // The marker pair on its own root-level line with non-HTML content is
    // protocol explanation, not a fragment.
    const markdown = `${HTML_RENDER_START_MARKER} and ${HTML_RENDER_END_MARKER}`;

    const tree = processMarkdown(markdown);

    expect(collectNodesByType(tree, 'htmlRenderBlock')).toHaveLength(0);
    // the prose line survives untouched as its original html node
    expect(collectNodesByType(tree, 'html').some((n) => n.value.includes(' and '))).toBe(true);
  });

  it('should not create a card when the one-line prose contains a bare <', () => {
    // A lone `<` (comparison "a < b") is not an HTML tag — still prose.
    const markdown = `${HTML_RENDER_START_MARKER}the cost is a < b days${HTML_RENDER_END_MARKER}`;

    const tree = processMarkdown(markdown);

    expect(collectNodesByType(tree, 'htmlRenderBlock')).toHaveLength(0);
    expect(collectNodesByType(tree, 'html').some((n) => n.value.includes('a < b'))).toBe(true);
  });

  it('should not treat a tag-like comparison token as HTML', () => {
    // "x<y>" is a comparison, not a real tag — no card, content preserved.
    const markdown = `${HTML_RENDER_START_MARKER}x<y> z${HTML_RENDER_END_MARKER}`;

    const tree = processMarkdown(markdown);

    expect(collectNodesByType(tree, 'htmlRenderBlock')).toHaveLength(0);
    expect(collectNodesByType(tree, 'html').some((n) => n.value.includes('x<y>'))).toBe(true);
  });

  it('should close a one-line fragment whose end marker trails more text', () => {
    // CommonMark merges the whole line into one node; the end marker with
    // trailing text on the same line must still close and keep the tail.
    const markdown = `${HTML_RENDER_START_MARKER}<div>A</div>${HTML_RENDER_END_MARKER} TRAIL`;

    const tree = processMarkdown(markdown);

    const nodes = collectNodesByType(tree, 'htmlRenderBlock');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].data?.hProperties).toEqual({ open: false });
    expect(nodes[0].data?.hChildren[0].value).toBe('<div>A</div>');
    expect(collectNodesByType(tree, 'text').some((n) => n.value.includes('TRAIL'))).toBe(true);
  });

  it('should close when the end marker trails the content line (asymmetric layout)', () => {
    // START on its own line, content + END glued on the next line.
    const markdown = [HTML_RENDER_START_MARKER, `<div>A</div>${HTML_RENDER_END_MARKER}`].join('\n');

    const tree = processMarkdown(markdown);

    const nodes = collectNodesByType(tree, 'htmlRenderBlock');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].data?.hProperties).toEqual({ open: false });
    expect(nodes[0].data?.hChildren[0].value).toBe('<div>A</div>');
  });

  it('should absorb indented (code-block) content inside a fragment', () => {
    const markdown = [HTML_RENDER_START_MARKER, '    <div>A</div>', HTML_RENDER_END_MARKER].join(
      '\n',
    );

    const tree = processMarkdown(markdown);

    const nodes = collectNodesByType(tree, 'htmlRenderBlock');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].data?.hProperties).toEqual({ open: false });
    expect(nodes[0].data?.hChildren[0].value).toBe('<div>A</div>');
  });

  it('should not absorb an indented code block separated by a blank line', () => {
    // Blank-line-separated indented code is regular content following an
    // open fragment — the code block must survive outside the card.
    const markdown = [HTML_RENDER_START_MARKER, '<div>A</div>', '', '    const x = 1;'].join('\n');

    const tree = processMarkdown(markdown);

    const nodes = collectNodesByType(tree, 'htmlRenderBlock');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].data?.hProperties).toEqual({ open: true });
    expect(nodes[0].data?.hChildren[0].value).toBe('<div>A</div>');
    expect(collectNodesByType(tree, 'code')).toHaveLength(1);
  });
});
