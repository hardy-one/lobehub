/**
 * Regression test for the "markdown LaTeX preprocessing must be a safe function"
 * fix (see patches/@lobehub__ui.patch → useMarkdownContent#findSafeBoundary).
 *
 * The LaTeX preprocess chain (`preprocessLaTeX`) rewrites `\(...\)` → `$...$` and
 * escapes `|` → `\vert{}` inside a `$...$` span. Those regexes assume the input's
 * delimiters are fully balanced. While a reply streams, the text is a *prefix* of
 * the final message, so an open `\(` whose `\)` has not arrived yet lets a
 * non-greedy regex reach across a neighbouring markdown table pipe and rewrite it
 * into a literal `\vert{}`, corrupting the whole message.
 *
 * This test feeds the kind of partial content that used to break and asserts the
 * renderer never emits `\vert{}`. Both the streaming (`StreamdownRender`) and the
 * non-streaming (`MarkdownRenderer`) paths call `useMarkdownContent`, so we render
 * with `enableStream={false}` for a deterministic, timer-free run.
 */
import { Markdown } from '@lobehub/ui';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

// A table cell containing an inline formula whose closing `\(...\)` has NOT yet
// streamed. Before the fix this produced a literal `\vert{}` in the rendered text.
const STREAMING_TABLE_WITH_OPEN_INLINE_MATH =
  '| 输入 | 连续 \\(e_t^{(n)} 个词/token | 连续 \\(n\\) 个词/token |';

describe('markdown LaTeX preprocessing is a safe function (streaming)', () => {
  it('keeps a table pipe as a pipe even while an inline \\( is still open', () => {
    const { container } = render(
      <Markdown enableStream={false} variant="chat">
        {STREAMING_TABLE_WITH_OPEN_INLINE_MATH}
      </Markdown>,
    );

    expect(container.textContent).not.toContain('\\vert{}');
  });

  it('still renders a fully-balanced inline formula and keeps the table pipes', () => {
    const complete = '| 输入 | 连续 \\(n\\) 个词/token | 连续 \\(m\\) 个词/token |';
    const { container } = render(
      <Markdown enableStream={false} variant="chat">
        {complete}
      </Markdown>,
    );

    expect(container.textContent).not.toContain('\\vert{}');
  });
});
