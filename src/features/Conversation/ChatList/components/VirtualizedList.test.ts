import { describe, expect, it } from 'vitest';

import { collectHtmlRenderMessageIds } from './VirtualizedList';

describe('collectHtmlRenderMessageIds', () => {
  const messages = [
    { content: 'hello', id: 'm1' },
    { content: '<!-- html-render-start --><div>x</div>', id: 'm2' },
    { content: 'plain', id: 'm3' },
    { content: 'tail <!-- html-render-start -->more', id: 'm4' },
  ];

  it('should keep generating fragment rows even when their height is cached', () => {
    const isGenerating = (id: string) => id === 'm2';
    const hasCachedHeight = () => true;
    const isInViewport = () => false;

    expect(
      collectHtmlRenderMessageIds(messages, { hasCachedHeight, isGenerating, isInViewport }),
    ).toEqual(['m2']);
  });

  it('should keep uncached fragment rows that are in the viewport', () => {
    const isGenerating = () => false;
    const hasCachedHeight = (id: string) => id === 'm2';
    const isInViewport = (id: string) => id === 'm4';

    expect(
      collectHtmlRenderMessageIds(messages, { hasCachedHeight, isGenerating, isInViewport }),
    ).toEqual(['m4']);
  });

  it('should not keep uncached fragment rows that are off-screen', () => {
    const isGenerating = () => false;
    const hasCachedHeight = () => false;
    const isInViewport = () => false;

    expect(
      collectHtmlRenderMessageIds(messages, { hasCachedHeight, isGenerating, isInViewport }),
    ).toEqual([]);
  });

  it('should drop finished fragment rows once their height is cached even when in viewport', () => {
    const isGenerating = () => false;
    const hasCachedHeight = () => true;
    const isInViewport = () => true;

    expect(
      collectHtmlRenderMessageIds(messages, { hasCachedHeight, isGenerating, isInViewport }),
    ).toEqual([]);
  });

  it('should ignore non-string content blocks', () => {
    const messages = [
      { content: [{ type: 'text', text: '<!-- html-render-start -->' }], id: 'm1' },
      { content: undefined, id: 'm2' },
    ];

    expect(
      collectHtmlRenderMessageIds(messages, {
        hasCachedHeight: () => false,
        isGenerating: () => false,
        isInViewport: () => true,
      }),
    ).toEqual([]);
  });

  it('should return an empty list without fragments', () => {
    expect(
      collectHtmlRenderMessageIds([{ content: 'no marker', id: 'm1' }], {
        hasCachedHeight: () => false,
        isGenerating: () => false,
        isInViewport: () => true,
      }),
    ).toEqual([]);
  });
});
