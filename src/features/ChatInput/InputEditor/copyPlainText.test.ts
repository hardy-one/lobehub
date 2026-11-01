import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { MarkdownPlugin } from '@lobehub/editor';
import {
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $setSelection,
  COPY_COMMAND,
  createEditor,
} from 'lexical';
import { beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

/**
 * The pnpm patch is what actually ships, so it is checked as a repository file. These
 * assertions hold no matter how dependencies were installed.
 */
const PATCH_FILE = path.resolve(process.cwd(), 'patches/@lobehub__editor.patch');
const PATCHED_LINE = 'if (!data["text/plain"]) clipboardData.setData("text/plain", markdown);';
const OVERWRITTEN_LINE = 'clipboardData.setData("text/plain", markdown);';

/** Both published entry points ship the same copy handler. */
const COPY_ENTRY_POINTS = ['es/plugins/markdown/plugin/index.js', 'es/headless.js'];

const getPatchSection = (file: string) => {
  const section = readFileSync(PATCH_FILE, 'utf8')
    .split(/^diff --git /m)
    .find((block) => block.startsWith(`a/${file} b/${file}`));

  if (!section) throw new Error(`patches/@lobehub__editor.patch has no diff for ${file}`);

  return section;
};

/** Code lines a diff section adds or removes, without the marker and indentation. */
const diffPayload = (section: string, marker: '+' | '-') =>
  section
    .split('\n')
    .filter((line) => line.startsWith(marker) && !line.startsWith(marker.repeat(3)))
    .map((line) => line.slice(1).trim());

describe('editor patch file', () => {
  it.each(COPY_ENTRY_POINTS)('%s copies the selection text into text/plain', (file) => {
    expect(diffPayload(getPatchSection(file), '+')).toContain(PATCHED_LINE);
  });

  it.each(COPY_ENTRY_POINTS)('%s stops writing markdown into text/plain', (file) => {
    const section = getPatchSection(file);

    expect(diffPayload(section, '-')).toContain(OVERWRITTEN_LINE);
    expect(diffPayload(section, '+')).not.toContain(OVERWRITTEN_LINE);
  });
});

const createPlugin = () => {
  const kernel = {
    registerDataSource: () => {},
    registerService: () => {},
    requireService: () => undefined,
  };

  return new MarkdownPlugin(kernel as never, {});
};

/** The package's own serializer, so the expected markdown tracks the real settings. */
const formatMarkdown = (markdown: string) =>
  createPlugin().markdownDataSource.formatMarkdown(markdown) as string;

/** The handler strips one trailing newline; the package does not export that helper. */
const serializedForClipboard = (markdown: string) => formatMarkdown(markdown).replace(/\r?\n$/, '');

const INSTALLED_PLUGIN = path.join(
  path.dirname(require.resolve('@lobehub/editor/package.json')),
  'es/plugins/markdown/plugin/index.js',
);

type CopyFixture = {
  /** Paragraph contents used to build the editor selection. */
  paragraphs: string[];
  /** What Lexical's selection text, and therefore `text/plain`, must contain. */
  plainText: string;
  /** Markdown source handed to the writer stub. */
  markdownSource: string;
};

const buildEditor = (paragraphs: string[]) => {
  const editor = createEditor({
    namespace: 'copy-handler-test',
    onError: (error) => {
      throw error;
    },
  });

  editor.update(
    () => {
      const root = $getRoot();
      root.clear();
      const textNodes = paragraphs.map((line) => {
        const paragraph = $createParagraphNode();
        const textNode = $createTextNode(line);
        paragraph.append(textNode);
        root.append(paragraph);
        return textNode;
      });

      const firstNode = textNodes[0];
      const lastNode = textNodes.at(-1)!;
      const selection = $createRangeSelection();
      selection.anchor.set(firstNode.getKey(), 0, 'text');
      selection.focus.set(lastNode.getKey(), paragraphs.at(-1)!.length, 'text');
      $setSelection(selection);
    },
    { discrete: true },
  );

  return editor;
};

const createCopyEvent = () => {
  const slots = new Map<string, string>();
  const clipboardData = {
    getData: (type: string) => slots.get(type) ?? '',
    setData: (type: string, value: string) => {
      slots.set(type, value);
    },
  };
  const event = Object.create(ClipboardEvent.prototype) as ClipboardEvent;
  Object.assign(event, { clipboardData, preventDefault: () => {} });
  return { event, slots };
};

/**
 * Runs the shipped `COPY_COMMAND` listener against a real Lexical editor and a fake
 * clipboard. `markdownDataSource.write` is stubbed because the real writer needs the
 * full editor kernel and returns nothing on a bare editor; the `text/markdown` slot is
 * still asserted against the package's serializer.
 */
const runCopy = ({ paragraphs, markdownSource }: CopyFixture) => {
  const editor = buildEditor(paragraphs);
  const plugin = createPlugin();
  plugin.markdownDataSource.write = () => serializedForClipboard(markdownSource);
  plugin.onInit(editor);

  const { event, slots } = createCopyEvent();
  const handled = editor.dispatchCommand(COPY_COMMAND, event);

  return { handled, slots };
};

describe('copy handler writes the clipboard slots', () => {
  beforeAll(() => {
    // These run against the installed package. `pnpm install` applies the patch; bun
    // does not, and would otherwise surface as a stack of unrelated failures.
    if (!readFileSync(INSTALLED_PLUGIN, 'utf8').includes(PATCHED_LINE)) {
      throw new Error(
        'the installed @lobehub/editor is not patched: run `pnpm install` (bun does not apply pnpm patches)',
      );
    }
  });

  it.each<CopyFixture & { name: string }>([
    {
      name: 'plain text with markdown punctuation',
      paragraphs: ['TEST_CONTENT_*_ALL'],
      plainText: 'TEST_CONTENT_*_ALL',
      markdownSource: 'TEST_CONTENT_*_ALL',
    },
    {
      name: 'bare URL',
      paragraphs: ['https://app.lobehub.com/'],
      plainText: 'https://app.lobehub.com/',
      markdownSource: 'https://app.lobehub.com/',
    },
    {
      name: 'line with inline code',
      paragraphs: ['use `foo_bar` here'],
      plainText: 'use `foo_bar` here',
      markdownSource: 'use `foo_bar` here',
    },
    {
      name: 'list',
      paragraphs: ['item_one', 'item_two'],
      plainText: 'item_one\nitem_two',
      markdownSource: '- item_one\n- item_two',
    },
  ])('$name: text/plain keeps the selection text, text/markdown keeps markdown', (fixture) => {
    const { handled, slots } = runCopy(fixture);

    expect(handled).toBe(true);
    expect(slots.get('text/plain')).toBe(fixture.plainText);
    expect(slots.get('text/markdown')).toBe(serializedForClipboard(fixture.markdownSource));
  });

  it('does not leak escapes from the markdown slot into text/plain', () => {
    const { slots } = runCopy({
      paragraphs: ['TEST_CONTENT_*_ALL'],
      plainText: 'TEST_CONTENT_*_ALL',
      markdownSource: 'TEST_CONTENT_*_ALL',
    });

    expect(slots.get('text/plain')).not.toContain('\\');
    expect(slots.get('text/markdown')).toBe('TEST_CONTENT\\_\\*\\_ALL');
  });
});

/**
 * Escaping belongs in the markdown slot, so this records why `text/plain` must not carry
 * that payload instead of "fixing" it in the serializer.
 */
describe('why text/plain must not carry the serialized markdown', () => {
  it('escapes punctuation and turns bare URLs into autolinks', () => {
    expect(formatMarkdown('TEST_CONTENT_*_ALL')).toBe('TEST_CONTENT\\_\\*\\_ALL\n');
    expect(formatMarkdown('https://app.lobehub.com/')).toBe('<https://app.lobehub.com/>\n');
  });
});
