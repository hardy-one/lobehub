import { HTML_RENDER_END_MARKER, HTML_RENDER_START_MARKER } from '@lobechat/const';
import { describe, expect, it } from 'vitest';

import { htmlRenderMarkdownToEditor } from './markdown';

describe('htmlRenderMarkdownToEditor', () => {
  it('converts html-render comment markers into a fenced html-render block', () => {
    const markdown = [
      'before',
      HTML_RENDER_START_MARKER,
      '<div class="card">hello</div>',
      HTML_RENDER_END_MARKER,
      'after',
    ].join('\n');

    expect(htmlRenderMarkdownToEditor(markdown)).toContain('```html-render');
    expect(htmlRenderMarkdownToEditor(markdown)).toContain('<div class="card">hello</div>');
    expect(htmlRenderMarkdownToEditor(markdown)).not.toContain(HTML_RENDER_START_MARKER);
    expect(htmlRenderMarkdownToEditor(markdown)).not.toContain(HTML_RENDER_END_MARKER);
  });

  it('keeps normal markdown untouched', () => {
    const markdown = '# title\n\nhello **world**';
    expect(htmlRenderMarkdownToEditor(markdown)).toBe(markdown);
  });
});
