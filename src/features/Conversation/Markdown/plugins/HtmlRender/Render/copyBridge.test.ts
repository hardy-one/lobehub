import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerHtmlRenderCopySource } from './copyBridge';

const selectNodeContents = (node: Node): void => {
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(node);
  selection?.removeAllRanges();
  selection?.addRange(range);
};

const createCopyEvent = (): { event: ClipboardEvent; transfer: DataTransfer } => {
  const transfer = new DataTransfer();
  const event = new ClipboardEvent('copy', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: transfer });
  return { event, transfer };
};

afterEach(() => {
  document.body.innerHTML = '';
  window.getSelection()?.removeAllRanges();
});

describe('registerHtmlRenderCopySource', () => {
  it('replaces a selected html-render iframe with its latest visible text', () => {
    document.body.innerHTML =
      '<div id="wrap">before <iframe data-html-render-copy-id="frame-1"></iframe> after</div>';
    const wrap = document.getElementById('wrap') as HTMLDivElement;
    const getText = vi.fn(() => '卡片内容');
    const unregister = registerHtmlRenderCopySource('frame-1', getText);

    selectNodeContents(wrap);
    const { event, transfer } = createCopyEvent();
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(getText).toHaveBeenCalledOnce();
    expect(transfer.getData('text/plain')).toBe('before 卡片内容 after');
    expect(transfer.getData('text/html')).toContain('卡片内容');

    unregister();
  });

  it('keeps native copy untouched when the selected range has no registered iframe', () => {
    document.body.innerHTML = '<div id="wrap">plain text</div>';
    const unregister = registerHtmlRenderCopySource('frame-1', () => '卡片内容');

    selectNodeContents(document.getElementById('wrap') as HTMLDivElement);
    const { event, transfer } = createCopyEvent();
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(transfer.getData('text/plain')).toBe('');
    unregister();
  });

  it('stops replacing the iframe after unregister', () => {
    document.body.innerHTML =
      '<div id="wrap">before <iframe data-html-render-copy-id="frame-1"></iframe> after</div>';
    const unregister = registerHtmlRenderCopySource('frame-1', () => '卡片内容');
    unregister();

    selectNodeContents(document.getElementById('wrap') as HTMLDivElement);
    const { event } = createCopyEvent();
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});
