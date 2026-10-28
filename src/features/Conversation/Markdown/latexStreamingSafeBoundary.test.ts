// @ts-expect-error -- the helper is exported by our local @lobehub/ui patch for focused unit coverage.
import { describe, expect, it } from 'vitest';

import { findSafeBoundary } from '../../../../node_modules/@lobehub/ui/es/hooks/useMarkdown/useMarkdownContent.mjs';

describe('findSafeBoundary', () => {
  it('stops before an unfinished inline formula in a markdown table', () => {
    const input = '| 输入 | 连续 \\(e_t^{(n)} 个词/token | 连续 \\(n\\) 个词/token |';
    const boundary = findSafeBoundary(input);

    expect(input.slice(0, boundary)).toBe('| 输入 | 连续 ');
    expect(input.slice(boundary)).toBe('\\(e_t^{(n)} 个词/token | 连续 \\(n\\) 个词/token |');
  });

  it('allows fully balanced inline formulas to be preprocessed', () => {
    const input = '| 输入 | 连续 \\(n\\) 个词/token |';

    expect(findSafeBoundary(input)).toBe(input.length);
  });

  it('does not treat currency values with a single dollar as unfinished math', () => {
    const input = 'The price is $100.';

    expect(findSafeBoundary(input)).toBe(input.length);
  });
});
