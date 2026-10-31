import {
  CodePlugin,
  CommonPlugin,
  type IEditor,
  Kernel,
  ListPlugin,
  MarkdownPlugin,
} from '@lobehub/editor';
import { $getRoot, $isElementNode, $isTextNode, type LexicalNode } from 'lexical';
import { describe, expect, it } from 'vitest';

import { readEditorText } from './readEditorText';

const FEFF = '\uFEFF';

/**
 * A composer with the plugins the real chat input registers for the rich text it
 * can produce: the markdown service, inline code, lists and shared rich-text
 * behaviour. `MarkdownPlugin` is what the send path detects; a composer without
 * it is the plain text fallback below.
 */
const createComposer = (
  text?: string,
  { plugins = [CommonPlugin, MarkdownPlugin, CodePlugin, ListPlugin], type = 'text' as const } = {},
) => {
  const kernel = new Kernel();
  const editor = kernel as unknown as IEditor;
  editor.registerPlugins(plugins);
  editor.initNodeEditor();
  if (text) editor.setDocument(type, text);
  return editor;
};

/** What the format actions do: the selected word becomes a formatted text node. */
const applyFormat = (editor: IEditor, needle: string, format: 'bold' | 'code') => {
  editor.getLexicalEditor()!.update(
    () => {
      const walk = (node: LexicalNode): boolean => {
        if (!$isElementNode(node)) return false;

        for (const child of node.getChildren()) {
          if ($isTextNode(child)) {
            const index = child.getTextContent().indexOf(needle);
            if (index === -1) continue;

            // `splitText(start, end)` returns the parts, so the middle one is
            // the text the person selected.
            const parts = child.splitText(index, index + needle.length);
            parts[index === 0 ? 0 : 1].toggleFormat(format);

            return true;
          }

          if (walk(child)) return true;
        }

        return false;
      };

      walk($getRoot());
    },
    { discrete: true },
  );
};

const blockTypes = (editor: IEditor) =>
  editor
    .getLexicalEditor()!
    .getEditorState()
    .read(() =>
      $getRoot()
        .getChildren()
        .map((node) => node.getType()),
    );

/** Reading the message back — what the composer does when it shows it again. */
const reload = (text: string) => createComposer(text, { type: 'markdown' });

describe('readEditorText', () => {
  it('sends bold and inline code as Markdown instead of dropping the markers', () => {
    const editor = createComposer('bold and code and 1_000_000');
    applyFormat(editor, 'bold', 'bold');
    applyFormat(editor, 'code', 'code');

    // The composer shows "bold" in bold and "code" as code, so the model has to
    // receive the same thing instead of the flattened words.
    expect(readEditorText(editor)).toBe('**bold** and `code` and 1_000_000');
  });

  it('keeps the caret placeholder of an inline code span out of the sent text', () => {
    const editor = createComposer('run `pnpm test` now', { type: 'markdown' });

    expect(readEditorText(editor)).toBe('run `pnpm test` now');
    expect(readEditorText(editor)).not.toContain(FEFF);
  });

  it('sends characters that read as Markdown syntax literally', () => {
    for (const text of [
      '*/10 * * * *',
      '1_000_000',
      'a_b_c 100% done',
      '<b>not html</b>',
      '*error* at startup',
    ]) {
      expect(readEditorText(createComposer(text))).toBe(text);
    }
  });

  it('keeps one Markdown block per paragraph the person sees', () => {
    expect(readEditorText(createComposer('A\n\nB', { type: 'markdown' }))).toBe('A\n\nB');
    // The text data source splits on a single newline, so two typed lines are
    // two paragraphs and have to reach the model as two paragraphs.
    expect(readEditorText(createComposer('A\nB'))).toBe('A\n\nB');
  });

  it('does not let a paragraph line continue the block above it', () => {
    const editor = createComposer('- one\n- two\n\nplain', { type: 'markdown' });

    expect(readEditorText(editor)).toBe('- one\n- two\n\nplain');
    // One newline would make "plain" a lazy continuation of the list item.
    expect(blockTypes(reload(readEditorText(editor)))).toEqual(['list', 'paragraph']);
  });

  it('keeps a heading, a list and a quote readable for the model', () => {
    const editor = createComposer('# Title\n\n- one\n- two\n\n> quoted', { type: 'markdown' });

    expect(readEditorText(editor)).toBe('# Title\n\n- one\n- two\n\n> quoted');
  });

  it('reads back to the document the person saw', () => {
    const editor = createComposer('A\n\n**bold** and `code`\n\n- one\n- two', {
      type: 'markdown',
    });

    const message = readEditorText(editor);
    const reloaded = reload(message);

    expect(blockTypes(reloaded)).toEqual(blockTypes(editor));
    expect(readEditorText(reloaded)).toBe(message);
  });

  it('drops an empty paragraph instead of replaying blank lines', () => {
    // Markdown has no empty block; the blank line the person typed is the
    // paragraph break itself.
    expect(readEditorText(createComposer('A\n\n\nB', { type: 'markdown' }))).toBe('A\n\nB');
  });

  it('sends the plain text of a composer without the markdown plugin', () => {
    const editor = createComposer('A\n\nB', { plugins: [CommonPlugin] });

    // That composer has no formatting to lose and reads the message back
    // through the text data source, which splits on a single newline.
    expect(readEditorText(editor)).toBe('A\n\nB');
  });

  it('does not add a space after the full-width punctuation the author typed', () => {
    const editor = createComposer(
      '第一段：加粗文本 与 code() 之间各保留一个空格。\n\n第二段：结束。',
    );

    applyFormat(editor, '加粗文本', 'bold');
    applyFormat(editor, 'code()', 'code');

    // The editor's writer pads a punctuation tail: neither "：" nor "。" gained a
    // space in what the person typed, so neither may gain one in the message.
    expect(readEditorText(editor)).toBe(
      '第一段：**加粗文本** 与 `code()` 之间各保留一个空格。\n\n第二段：结束。',
    );
  });

  it('keeps a space the author did type after full-width punctuation', () => {
    const editor = createComposer('第一段： 加粗文本');

    applyFormat(editor, '加粗文本', 'bold');

    expect(readEditorText(editor)).toBe('第一段： **加粗文本**');
  });

  it('keeps the pad that stops ASCII punctuation from fusing with a marker', () => {
    const editor = createComposer('Note:bold');

    applyFormat(editor, 'bold', 'bold');

    // Without the pad this would be "Note:**bold**"; the ASCII colon has no
    // spacing of its own, so the writer's pad is what separates the two.
    expect(readEditorText(editor)).toBe('Note: **bold**');
  });

  it('sends an empty string for an editor that cannot serialize', () => {
    expect(readEditorText(undefined)).toBe('');
  });
});
