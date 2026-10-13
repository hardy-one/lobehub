/**
 * @vitest-environment happy-dom
 */
import katex from 'katex';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The extension is imported for its own side effect and memoised per module instance,
 * so each case reloads the module to observe a fresh import.
 */
const loadExtension = async () => {
  vi.resetModules();

  return import('./latexCopy');
};

const renderFormula = (tex: string, displayMode = false) => {
  const paragraph = document.createElement('p');
  paragraph.innerHTML = katex.renderToString(tex, { displayMode, throwOnError: true });
  document.body.append(paragraph);

  return paragraph;
};

/** Select `element`, fire a copy event, and return the clipboard the page wrote. */
const copySelection = (element: Element) => {
  const range = document.createRange();
  range.setStartBefore(element);
  range.setEndAfter(element);

  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);

  const clipboardData = new DataTransfer();
  document.dispatchEvent(new ClipboardEvent('copy', { cancelable: true, clipboardData }));

  return clipboardData;
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('enableKatexCopyTex', () => {
  it('puts the LaTeX source of an inline formula on the clipboard', async () => {
    const { enableKatexCopyTex } = await loadExtension();
    await enableKatexCopyTex();

    const clipboardData = copySelection(renderFormula('a^2 + b^2'));

    expect(clipboardData.getData('text/plain')).toBe('$a^2 + b^2$');
  });

  it('wraps a display formula in display delimiters', async () => {
    const { enableKatexCopyTex } = await loadExtension();
    await enableKatexCopyTex();

    const clipboardData = copySelection(renderFormula('a^2 + b^2', true));

    expect(clipboardData.getData('text/plain')).toBe('$$a^2 + b^2$$');
  });

  it('imports the extension once however many callers ask for it', async () => {
    const { enableKatexCopyTex } = await loadExtension();

    // The extension registers one document-level `copy` listener when it is imported,
    // so sharing the first import is what keeps a second listener from being installed.
    const loading = enableKatexCopyTex();

    expect(enableKatexCopyTex()).toBe(loading);

    await Promise.all([loading, enableKatexCopyTex()]);
  });
});
