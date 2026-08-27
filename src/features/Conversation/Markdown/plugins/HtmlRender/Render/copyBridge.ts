const copySources = new Map<string, () => string>();
let copyListenerInstalled = false;

/**
 * Serialize the current host selection after replacing every selected
 * html-render iframe with its latest visible text. Returns null when the
 * selection does not contain a registered html-render iframe or none of the
 * registered iframes has text yet (native copy stays untouched in that case).
 */
const buildClipboardPayload = (): { html: string; text: string } | null => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

  const holder = document.createElement('div');
  holder.appendChild(selection.getRangeAt(0).cloneContents());

  const iframes = Array.from(holder.querySelectorAll('iframe[data-html-render-copy-id]'));
  if (iframes.length === 0) return null;

  let replaced = false;
  for (const iframe of iframes) {
    const frameId = iframe.getAttribute('data-html-render-copy-id');
    const text = frameId ? copySources.get(frameId)?.() : undefined;
    if (!text) continue;

    // Text nodes preserve the iframe's position inside the surrounding
    // selection (before/after text stays in the right order).
    iframe.replaceWith(document.createTextNode(text));
    replaced = true;
  }

  return replaced ? { html: holder.innerHTML, text: holder.textContent ?? '' } : null;
};

const handleDocumentCopy = (event: ClipboardEvent): void => {
  const clipboardData = event.clipboardData;
  if (!clipboardData) return;

  const payload = buildClipboardPayload();
  if (!payload) return;

  event.preventDefault();
  clipboardData.setData('text/plain', payload.text);
  clipboardData.setData('text/html', payload.html);
};

/**
 * Register a live text provider for one html-render iframe. The document-level
 * copy listener is installed once; the returned cleanup removes the source.
 */
export const registerHtmlRenderCopySource = (
  frameId: string,
  getText: () => string,
): (() => void) => {
  if (!copyListenerInstalled) {
    copyListenerInstalled = true;
    document.addEventListener('copy', handleDocumentCopy);
  }

  copySources.set(frameId, getText);
  return () => {
    if (copySources.get(frameId) === getText) copySources.delete(frameId);
  };
};
