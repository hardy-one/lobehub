import { HTML_RENDER_END_MARKER, HTML_RENDER_START_MARKER } from '@lobechat/const';
import { SKIP, visit } from 'unist-util-visit';

export { HTML_RENDER_END_MARKER, HTML_RENDER_START_MARKER } from '@lobechat/const';

export const HTML_RENDER_TAG = 'html-render';

/**
 * Find a marker that starts on its own line, allowing leading whitespace
 * (indented markers). Literal marker strings embedded in the middle of prose
 * — e.g. a model explaining the protocol, which the preset itself teaches —
 * must NOT be treated as real markers, otherwise an open fragment would
 * swallow and truncate unrelated content at the literal string.
 */
const findLineAnchoredMarker = (text: string, marker: string): number => {
  let idx = text.indexOf(marker);
  while (idx >= 0) {
    const before = text.slice(0, idx);
    // Line start = string start (possibly whitespace-only prefix), or a
    // newline followed by nothing but whitespace.
    if (before.trim() === '' || /(?:^|\n)[ \t]*$/.test(before)) return idx;
    idx = text.indexOf(marker, idx + marker.length);
  }
  return -1;
};

/**
 * Locate the closing marker inside the start node's own content: either
 * line-anchored (own line, with optional leading whitespace) or trailing at
 * the end of the text (a one-line fragment `START<div>A</div>END` that
 * CommonMark merges into a single html node). Only used for the content that
 * shares the start marker's line — sibling collection stays strictly
 * line-anchored so a literal end marker at the end of a prose paragraph is
 * not mistaken for a real closure.
 */
const findClosingEndMarker = (text: string): number => {
  const lineStart = findLineAnchoredMarker(text, HTML_RENDER_END_MARKER);
  if (lineStart >= 0) return lineStart;
  let idx = text.indexOf(HTML_RENDER_END_MARKER);
  while (idx >= 0) {
    if (text.slice(idx + HTML_RENDER_END_MARKER.length).trim() === '') return idx;
    idx = text.indexOf(HTML_RENDER_END_MARKER, idx + 1);
  }
  return -1;
};

/**
 * Flatten a paragraph's children back into their original text. Inline html
 * nodes keep their verbatim value, everything else falls back to text content
 * so no fragment content is dropped when it was parsed as markdown.
 *
 * Known trade-off: image nodes lose their alt/url (external resources are
 * forbidden by the output preset anyway) and link nodes keep only their
 * visible text, not the destination.
 */
const inlineChildrenToString = (children: any[]): string =>
  children
    .map((child) => {
      if (child.type === 'html' || child.type === 'text') return child.value ?? '';
      if (child.value != null) return String(child.value);
      if (child.children) return inlineChildrenToString(child.children);
      return '';
    })
    .join('');

/**
 * Whether a line-anchored end marker exists ahead of `fromIndex` but BEFORE
 * the next fragment's start marker. Used to keep collecting
 * blank-line-separated blocks when a closed fragment spans them, while still
 * stopping at blank lines for genuinely open fragments — without mistaking a
 * LATER fragment's end marker (or swallowing that fragment's start marker)
 * as our own closure.
 */
const hasEndMarkerAhead = (children: any[], fromIndex: number): boolean => {
  for (let j = fromIndex; j < children.length; j += 1) {
    const sibling = children[j];
    if (sibling.type === 'html' || sibling.type === 'text' || sibling.type === 'code') {
      if (findLineAnchoredMarker(sibling.value, HTML_RENDER_END_MARKER) >= 0) return true;
      // A new fragment starts here — stop scanning; its end marker belongs
      // to that fragment, not ours.
      if (findLineAnchoredMarker(sibling.value, HTML_RENDER_START_MARKER) >= 0) return false;
    } else if (sibling.type === 'paragraph') {
      const text = inlineChildrenToString(sibling.children);
      if (findLineAnchoredMarker(text, HTML_RENDER_END_MARKER) >= 0) return true;
      if (findLineAnchoredMarker(text, HTML_RENDER_START_MARKER) >= 0) return false;
    }
  }
  return false;
};

/**
 * Minimum length of an unclosed (still streaming) fragment before we render
 * a live preview. Shorter fragments are left untouched — the next streamed
 * chunk re-runs this plugin anyway.
 */
const MIN_LIVE_PREVIEW_CHARS = 6;

/**
 * Whether sibling collection should stop at the current node: a blank line
 * separates it from the previous collected node (regular content following
 * an open fragment), and no end marker exists ahead that would make it part
 * of a closed fragment. Missing positions (synthetic AST only — remark-parse
 * always sets them) fail conservative: do not absorb the sibling.
 */
const shouldStopAtBlankLine = (children: any[], fromIndex: number, lastIndex: number): boolean => {
  const prev = children[lastIndex];
  const sibling = children[fromIndex];
  if (!prev?.position || !sibling.position) return true;
  return (
    sibling.position.start.line - prev.position.end.line > 1 &&
    !hasEndMarkerAhead(children, fromIndex)
  );
};

/**
 * remark plugin — extract raw HTML fragments wrapped in
 * `<!-- html-render-start -->` / `<!-- html-render-end -->` markers and
 * replace them with a single custom `html-render` node.
 *
 * Why scan siblings instead of looking for a standalone end-marker node:
 * CommonMark parses a block-level tag (e.g. `<div>`) as an HTML block that
 * runs until the first blank line, so a marker line right after the fragment
 * without a blank line is swallowed INTO the same `html` node. Scanning the
 * collected text for a line-anchored end marker handles both layouts (with
 * and without blank lines between fragment and marker).
 *
 * Streaming: when the end marker has not arrived yet the remaining sibling
 * nodes are collected as the partial content and the node is marked
 * `open` — react-markdown re-parses on every streamed chunk, so the live
 * preview updates for free.
 *
 * Known limitation: markers inside a paragraph (inline fragments) produce a
 * block-level card nested in a `<p>`, which browsers auto-split — acceptable
 * for v1; the output preset instructs models to emit fragments as standalone
 * blocks.
 *
 * Known limitation: two fragments with NO blank line between them collapse
 * into one CommonMark HTML block, so only the first fragment is parsed (the
 * second one's content is dropped as unparsed html). The output preset tells
 * models to separate fragments with blank lines, which avoids this.
 */
/**
 * A marker comment that appears as its own inline html node inside a
 * paragraph with non-empty text siblings is prose — e.g. a model explaining
 * the protocol ("Use <!-- html-render-start --> and … to wrap HTML") —
 * not a fragment boundary.
 */
const isProseMarker = (parent: any, index: number): boolean => {
  if (parent?.type !== 'paragraph') return false;
  const hasContent = (node: any): boolean =>
    Boolean(node && typeof node.value === 'string' && node.value.trim());
  return hasContent(parent.children[index - 1]) || hasContent(parent.children[index + 1]);
};

/**
 * Loose "looks like real HTML" check for one-line fragments: a closing tag,
 * a self-closing tag, or an opening tag with attributes. A bare `<` or a
 * bare tag-like token from a comparison ("x<y>", "a < b") does not count.
 */
const looksLikeHtml = (content: string): boolean =>
  /<\/[a-z]/i.test(content) ||
  /<[a-z][^>]*\/>/i.test(content) ||
  /<[a-z][a-z0-9-]*\s[^>]*>/i.test(content);

export const remarkHtmlRender = () => (tree: any) => {
  visit(tree, 'html', (node, index, parent) => {
    if (typeof index !== 'number' || isProseMarker(parent, index)) return;

    // Start markers may be indented or share their line with fragment
    // content (CommonMark merges `START<div>…` into one html node) — only
    // the line-anchored position matters.
    const startMarkerIdx = findLineAnchoredMarker(node.value, HTML_RENDER_START_MARKER);
    if (startMarkerIdx < 0) return;

    const startIndex = index as number;

    let closed = false;
    let lastIndex = startIndex;
    // Text that follows the end marker inside the same `html` node — must be
    // preserved as a sibling instead of being deleted with the fragment.
    let tail = '';

    // Content that shares the start marker's line (same html node).
    let raw = '';
    if (node.value.trim() !== HTML_RENDER_START_MARKER) {
      raw = node.value.slice(startMarkerIdx + HTML_RENDER_START_MARKER.length);
      // The whole one-line fragment may live in this node, including the end
      // marker — close here instead of leaving the fragment open forever.
      const endMarkerIdx = findClosingEndMarker(raw);
      if (endMarkerIdx >= 0) {
        const content = raw.slice(0, endMarkerIdx).trim();
        // A one-line closure whose content has no real HTML is prose
        // explaining the protocol ("<!-- html-render-start --> and …"), not
        // a fragment — skip it entirely. Note this heuristic is specific to
        // the one-line path: multi-line fragments deliberately keep
        // plain-text content (a text-only fragment is a valid, if unusual,
        // protocol usage that cannot be told apart from prose).
        if (!looksLikeHtml(content)) return;
        tail = raw.slice(endMarkerIdx + HTML_RENDER_END_MARKER.length);
        raw = content;
        closed = true;
      } else if (looksLikeHtml(raw)) {
        // The end marker trails the one-line fragment with more text on the
        // same line (`START<div>A</div>END TRAIL`). CommonMark merged the
        // whole line into this node, so nothing can be collected from
        // siblings — split here and keep the tail.
        const looseIdx = raw.indexOf(HTML_RENDER_END_MARKER);
        if (looseIdx >= 0) {
          tail = raw.slice(looseIdx + HTML_RENDER_END_MARKER.length);
          raw = raw.slice(0, looseIdx);
          closed = true;
        }
      }
    }

    for (let i = startIndex + 1; i < parent.children.length; i += 1) {
      // The fragment may already be closed by a one-line end marker in the
      // start node's own content — nothing more to collect.
      if (closed) break;

      const sibling = parent.children[i];
      let text: string | null = null;

      if (
        sibling.type === 'html' ||
        sibling.type === 'text' ||
        // Indented code blocks: a 4-space/tab-indented content line parses
        // as `code` (value already de-indented) — absorb it so indented
        // fragment content is not silently dropped.
        sibling.type === 'code'
      ) {
        text = sibling.value;
        // Blank-line guard: a block separated by a blank line is probably
        // content that follows an open fragment. Closure wins: when an end
        // marker still exists ahead (a closed fragment with
        // blank-line-separated blocks) collection continues — otherwise a
        // naive guard would never consume the end marker and permanently
        // strand the fragment in the open state.
        if (shouldStopAtBlankLine(parent.children, i, lastIndex)) break;
      } else if (sibling.type === 'paragraph') {
        // Inline fragments (e.g. `<b>`/`<span>` or plain text lines) parse as
        // a paragraph rather than top-level html nodes — collect the inline
        // html/text verbatim so the fragment still renders. Same closure-first
        // blank-line guard as above: a blank-line-separated paragraph inside
        // a closed fragment still gets collected, otherwise the end marker
        // would never be consumed and the fragment would stay open forever.
        if (shouldStopAtBlankLine(parent.children, i, lastIndex)) break;
        // Everything else (link, strong, …) is flattened to its text content.
        text = inlineChildrenToString(sibling.children);
      }

      // A non-collectible sibling (list, blockquote, …) means the fragment
      // was interrupted by markdown structure — stop collecting here.
      if (text === null) break;

      // Only a marker that starts on its own line closes the fragment from a
      // sibling — a literal marker string in the middle of prose is prose.
      // A trailing end marker on a sibling whose content is real HTML
      // (`SM\n<div>A</div>EM` — the content line carries the marker) also
      // closes, mirroring the start node's one-line acceptance.
      let endMarkerIndex = findLineAnchoredMarker(text, HTML_RENDER_END_MARKER);
      if (endMarkerIndex < 0) {
        const looseIdx = text.indexOf(HTML_RENDER_END_MARKER);
        if (
          looseIdx >= 0 &&
          text.slice(looseIdx + HTML_RENDER_END_MARKER.length).trim() === '' &&
          looksLikeHtml(text.slice(0, looseIdx))
        ) {
          endMarkerIndex = looseIdx;
        }
      }
      if (endMarkerIndex >= 0) {
        raw += text.slice(0, endMarkerIndex);
        // CommonMark may swallow the end marker AND the text after it into
        // the same `html` node (HTML blocks run until a blank line) — keep
        // the tail so content after the fragment is not silently dropped.
        tail = text.slice(endMarkerIndex + HTML_RENDER_END_MARKER.length);
        closed = true;
        lastIndex = i;
        break;
      }

      raw += text;
      lastIndex = i;
    }

    const rawHtml = raw.trim();

    // Closed but empty — likely a stray marker from the model, leave as is.
    if (closed && !rawHtml) return;
    // Still streaming and too short for a meaningful preview — wait for more.
    if (!closed && rawHtml.length < MIN_LIVE_PREVIEW_CHARS) return;

    const customNode = {
      data: {
        hChildren: [{ type: 'text', value: rawHtml }],
        hName: HTML_RENDER_TAG,
        hProperties: { open: !closed },
      },
      position: node.position,
      type: 'htmlRenderBlock',
    };

    const replacement: any[] = [customNode];
    if (tail) replacement.push({ type: 'text', value: tail });

    parent.children.splice(startIndex, lastIndex - startIndex + 1, ...replacement);
    return [SKIP, startIndex + 1];
  });
};
