import { SKIP, visit } from 'unist-util-visit';

/**
 * Rehype plugin that preserves the source line breaks of raw HTML nodes which
 * are about to be rendered as literal text.
 *
 * When `allowHtml` is disabled, `react-markdown` converts remaining HAST `raw`
 * nodes into plain text nodes. Normal CSS whitespace handling then collapses
 * their `\n` characters into spaces, so a multi-line HTML fragment is displayed
 * on a single line. This plugin wraps those raw nodes in a `white-space:
 * pre-line` container instead: tags and comments remain escaped text, while
 * every source line break is kept.
 *
 * The plugin is intentionally self-gating: when HTML rendering is enabled,
 * `rehype-raw` runs before it and leaves no `raw` nodes to transform.
 */
export const rehypeRawText = () => (tree: any) => {
  visit(tree, 'raw', (node: any, index: number | undefined, parent: any) => {
    if (index === undefined || !parent || typeof node.value !== 'string') return;

    // Root-level raw nodes come from CommonMark HTML blocks and should stay
    // block-level. Inline raw nodes (inside a paragraph) stay inline.
    const tagName = parent.type === 'root' ? 'div' : 'span';

    parent.children[index] = {
      children: [{ type: 'text', value: node.value }],
      properties: { style: 'white-space:pre-line' },
      tagName,
      type: 'element',
    };

    // The inserted element contains the original text as its only child; do
    // not visit it again as a raw node.
    return [SKIP, index + 1];
  });
};
