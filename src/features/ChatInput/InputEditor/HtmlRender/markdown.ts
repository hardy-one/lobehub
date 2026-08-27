import { HTML_RENDER_END_MARKER, HTML_RENDER_START_MARKER } from '@lobechat/const';

const escapeRegExp = (value: string): string => value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The Lexical editor's markdown parser drops HTML comments
 * (`<!-- ... -->`) before custom readers can see them. To keep the original
 * chat wire format untouched, this converts HTML-Render comment markers into
 * an editor-internal fenced code block with the `html-render` language.
 *
 * `HtmlRenderPlugin` reads that fenced block back into an `HtmlRenderNode`,
 * and its markdown writer restores the original comment markers on save.
 */
export const htmlRenderMarkdownToEditor = (markdown: string): string => {
  const start = escapeRegExp(HTML_RENDER_START_MARKER);
  const end = escapeRegExp(HTML_RENDER_END_MARKER);

  return markdown.replaceAll(
    new RegExp(`${start}\\s*([\\s\\S]*?)\\s*${end}`, 'g'),
    (_match, content: string) => `\`\`\`html-render\n${content.trim()}\n\`\`\``,
  );
};
