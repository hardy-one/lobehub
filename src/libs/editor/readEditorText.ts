import { $isCursorNode, type IEditor, IMarkdownShortCutService } from '@lobehub/editor';
import { $getRoot, $isElementNode, type LexicalNode } from 'lexical';

/**
 * A node whose text form is not its label: the runtime parses the form back out
 * of the message text. A topic reference implements it as the `<refer_topic />`
 * tag the context engine resolves into the referenced conversation.
 */
export interface TagFormNode {
  toTag: () => string;
}

type MarkdownWriter = (ctx: MarkdownWriterContext, node: LexicalNode) => boolean | void;

type MarkdownWriterRegistry = Record<string, MarkdownWriter>;

/**
 * Punctuation that carries no word boundary of its own: the editor pads every
 * punctuation tail, but for these a following `**` or backtick cannot fuse into
 * a different token, so the pad is only a space the person did not type.
 */
const FULL_WIDTH_PUNCTUATION_TAIL =
  /[\u2014\u2018-\u201F\u2026\u3001-\u303F\uFF01-\uFF0F\uFF1A-\uFF20\uFF3B-\uFF40\uFF5B-\uFF65]$/;

/**
 * Mirrors the editor's own writer context, so the message text is written by the
 * very writers that render the composer: a writer either appends the text of
 * the block it is in, or wraps its children.
 */
class MarkdownWriterContext {
  private after = '';
  private before = '';
  private readonly children: (string | MarkdownWriterContext)[] = [];
  private processor?: (before: string, content: string, after: string) => string;

  constructor(private readonly writers: MarkdownWriterRegistry) {}

  appendLine = (line: string) => {
    this.children.push(line);
  };

  newChild = () => {
    const child = new MarkdownWriterContext(this.writers);
    this.children.push(child);
    return child;
  };

  wrap = (before: string, after: string) => {
    this.before = before;
    this.after = after;
  };

  /** Tables, alerts and footnotes post-process the wrapped content. */
  addProcessor = (processor: (before: string, content: string, after: string) => string) => {
    this.processor = processor;
  };

  /**
   * Writes a text run through the editor's own writer, dropping the single pad
   * the writer adds after a full-width punctuation tail: that pad exists so a
   * following Markdown marker never fuses with the character before it, but for
   * full-width punctuation it is a space the author never typed, and it would
   * reach the message text as one. A trailing space the author did type is
   * written as the run's own tail, so it is not the pad and stays.
   */
  writeText = (node: LexicalNode, writer: MarkdownWriter): boolean | void => {
    const written = this.children.length;
    const handled = writer(this, node);

    if (this.children.length === written || this.children.at(-1) !== ' ') return handled;

    const text = node.getTextContent();
    if (text !== text.trimEnd()) return handled;
    if (!FULL_WIDTH_PUNCTUATION_TAIL.test(text)) return handled;

    this.children.pop();

    return handled;
  };

  processChild = (parentContext: MarkdownWriterContext, child: LexicalNode) => {
    // A node with a tag form is emitted as that tag instead of its label, so it
    // does not depend on the plugin having registered a writer.
    const tag = tagFormOf(child);
    if (tag !== undefined) {
      parentContext.appendLine(tag);
      return;
    }

    // The caret placeholder inside an inline code node is a character the person
    // never typed; the composer renders it as the caret.
    if ($isCursorNode(child)) return;

    const context = $isElementNode(child) ? parentContext.newChild() : parentContext;

    const writer = this.writers[child.getType()];
    if (writer) {
      const handled =
        child.getType() === 'text' ? context.writeText(child, writer) : writer(context, child);
      if (handled) return;
    }

    if ($isElementNode(child)) {
      for (const grandChild of child.getChildren()) this.processChild(context, grandChild);
    }
  };

  toString = (): string => {
    const content = this.children.map((child) => child.toString()).join('');
    return this.processor
      ? this.processor(this.before, content, this.after)
      : `${this.before}${content}${this.after}`;
  };
}

const tagFormOf = (node: LexicalNode): string | undefined => {
  const candidate = node as Partial<TagFormNode>;
  return typeof candidate.toTag === 'function' ? candidate.toTag() : undefined;
};

/**
 * The writers registered by the editor's plugins, keyed by lexical node type.
 *
 * The markdown service publishes `registerMarkdownWriter` but not the registry,
 * and `getDocument('markdown')` is not a substitute: it runs the document
 * through remark afterwards, which backslash-escapes characters that are plain
 * text to the author (a cron schedule typed literally came back with every
 * asterisk escaped). Reading the registry is the only way to get the writers'
 * own output. A composer without the markdown plugin has no registry — and cannot
 * produce formatting either — so it falls back to the plain text projection below.
 */
const markdownWritersOf = (editor?: IEditor): MarkdownWriterRegistry | undefined => {
  const service = editor?.requireService(IMarkdownShortCutService) as
    (IMarkdownShortCutService & { markdownWriters?: MarkdownWriterRegistry }) | null | undefined;

  const writers = service?.markdownWriters;
  return writers && Object.keys(writers).length > 0 ? writers : undefined;
};

/**
 * Plain text projection for a composer without the markdown plugin: one string
 * per top-level block, joined with the single newline the text data source
 * splits on, so reading the message back into that composer is exact.
 */
const projectTextOnly = (node: LexicalNode): string => {
  const tag = tagFormOf(node);
  if (tag !== undefined) return tag;
  if ($isCursorNode(node)) return '';
  if (!$isElementNode(node)) return node.getTextContent();

  const children = node.getChildren();
  return children
    .map((child, index) => {
      const text = projectTextOnly(child);
      // Block children are separated by a blank line, matching lexical.
      const needsBreak =
        $isElementNode(child) && index !== children.length - 1 && !child.isInline();
      return needsBreak ? `${text}\n\n` : text;
    })
    .join('');
};

const projectBlock = (writers: MarkdownWriterRegistry, node: LexicalNode): string => {
  const context = new MarkdownWriterContext(writers);
  context.processChild(context, node);

  // Writers terminate a block with the document's block break; the projection
  // supplies the block boundary itself, so the trailing break is dropped.
  return context.toString().replace(/\n+$/, '');
};

/**
 * The composer document as the text of the message it sends.
 *
 * What the person sees is what the model receives: bold, inline code, headings,
 * lists and quotes reach the message as their Markdown form instead of being
 * flattened to their words, and the caret placeholder inside an inline code
 * span is not part of the text. Characters that are plain text to the author
 * stay literal, because the projection uses the editor's writers without the
 * remark re-serialization `getDocument('markdown')` applies.
 *
 * Markdown separates blocks with a blank line, so the projection joins the
 * top-level blocks with one. A single newline would hand the model one
 * paragraph with a soft break where the person sees two, and would let a
 * paragraph line continue the list or quote above it. An empty block has no
 * Markdown form, so it is dropped instead of adding blank lines the next read
 * would drop anyway.
 *
 * Nodes the runtime needs as tags keep their tag: a topic reference has to reach
 * the message text as `<refer_topic name id />`, because the context engine
 * resolves referenced conversations by parsing it out of the content.
 *
 * Shared by the composer send path and the edit modal, so a re-edited message
 * keeps the same text the person sees.
 */
const projectDocumentMarkdown = (editor?: IEditor): string => {
  const blocks = $getRoot().getChildren();
  const writers = markdownWritersOf(editor);

  if (!writers) return blocks.map((node) => projectTextOnly(node)).join('\n');

  return blocks
    .map((node) => projectBlock(writers, node))
    .filter((block) => block.length > 0)
    .join('\n\n');
};

/**
 * The message text of an editor, trimmed: the projection above, or an empty
 * string for an editor that can no longer serialize its document.
 */
export const readEditorText = (editor?: IEditor): string => {
  const lexicalEditor = editor?.getLexicalEditor();
  if (!editor || !lexicalEditor) return '';

  return lexicalEditor
    .getEditorState()
    .read(() => projectDocumentMarkdown(editor))
    .trimEnd();
};
