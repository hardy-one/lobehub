import { describe, expect, it, vi } from 'vitest';

import {
  MAX_DOCUMENT_REFERENCE_CHARS,
  MAX_DOCUMENT_REFERENCES,
  parseReferDocumentTags,
  resolveDocumentReferences,
  resolveDocumentReferencesByMessage,
} from '../resolveDocumentReferences';

describe('parseReferDocumentTags', () => {
  it('parses tags across messages and dedupes by id', () => {
    const refs = parseReferDocumentTags([
      { content: 'See <refer_document name="Voice" id="doc-1" /> and' },
      { content: 'again <refer_document name="Voice" id="doc-1" />' },
      { content: '<refer_document id="doc-2" name="Spec" />' },
      { content: [{ type: 'text', text: '<refer_document id="ignored" />' }] },
    ]);

    expect(refs).toEqual([
      { documentId: 'doc-1', latest: false, title: 'Voice' },
      { documentId: 'doc-2', latest: false, title: 'Spec' },
    ]);
  });

  it('orders references by their most recent use', () => {
    const refs = parseReferDocumentTags([
      { content: '<refer_document name="A" id="doc-a" />', role: 'user' },
      { content: '<refer_document name="B" id="doc-b" />', role: 'user' },
      { content: '<refer_document id="doc-a" />', role: 'user' },
    ]);

    expect(refs).toEqual([
      { documentId: 'doc-b', latest: false, title: 'B' },
      { documentId: 'doc-a', latest: true, title: 'A' },
    ]);
  });

  it('reads tags whose markup was markdown-escaped', () => {
    expect(
      parseReferDocumentTags([{ content: '\\<refer\\_document name="Voice" id="doc-1" />' }]),
    ).toEqual([{ documentId: 'doc-1', latest: true, title: 'Voice' }]);
  });

  it('ignores refer_topic tags', () => {
    expect(parseReferDocumentTags([{ content: '<refer_topic name="T" id="tpc_1" />' }])).toEqual(
      [],
    );
  });
});

describe('resolveDocumentReferences', () => {
  it('returns undefined without tags', async () => {
    const lookup = vi.fn();
    expect(await resolveDocumentReferences([{ content: 'plain' }], lookup)).toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('resolves content and prefers the stored title', async () => {
    const refs = await resolveDocumentReferences(
      [{ content: '<refer_document name="Old" id="doc-1" />' }],
      async () => ({ content: 'Body', title: 'Current' }),
    );

    expect(refs).toEqual([{ content: 'Body', documentId: 'doc-1', title: 'Current' }]);
  });

  it('truncates long content to the budget', async () => {
    const refs = await resolveDocumentReferences(
      [{ content: '<refer_document name="Long" id="doc-1" />' }],
      async () => ({ content: 'x'.repeat(MAX_DOCUMENT_REFERENCE_CHARS + 10) }),
    );

    expect(refs?.[0].content).toHaveLength(MAX_DOCUMENT_REFERENCE_CHARS);
    expect(refs?.[0].truncated).toBe(true);
    expect(refs?.[0].title).toBe('Long');
  });

  it('keeps a reference without content when the lookup misses or throws', async () => {
    const refs = await resolveDocumentReferences(
      [
        {
          content:
            '<refer_document name="Missing" id="doc-1" /><refer_document name="Broken" id="doc-2" />',
        },
      ],
      async (id) => {
        if (id === 'doc-2') throw new Error('boom');
        return null;
      },
    );

    expect(refs).toEqual([
      { documentId: 'doc-1', title: 'Missing' },
      { documentId: 'doc-2', title: 'Broken' },
    ]);
  });

  it('inlines only documents the latest user message references', async () => {
    const lookup = vi.fn(async () => ({ content: 'Body' }));

    const refs = await resolveDocumentReferences(
      [
        { content: '<refer_document name="Old" id="doc-old" />', role: 'user' },
        { content: 'Done.', role: 'assistant' },
        { content: '<refer_document name="New" id="doc-new" />', role: 'user' },
        { content: 'Reading.', role: 'assistant' },
      ],
      lookup,
    );

    expect(refs).toEqual([
      { documentId: 'doc-old', earlierTurn: true, title: 'Old' },
      { content: 'Body', documentId: 'doc-new', title: 'New' },
    ]);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith('doc-new');
  });

  it('inlines a document referenced again after older ones exceed the cap', async () => {
    const count = MAX_DOCUMENT_REFERENCES + 1;
    const messages = [
      ...Array.from({ length: count }, (_, i) => ({
        content: `<refer_document name="D${i}" id="doc-${i}" />`,
        role: 'user',
      })),
      { content: '<refer_document name="D0" id="doc-0" />', role: 'user' },
    ];
    const lookup = vi.fn(async () => ({ content: 'c' }));

    const refs = await resolveDocumentReferences(messages, lookup);

    expect(refs?.filter((ref) => ref.earlierTurn)).toHaveLength(MAX_DOCUMENT_REFERENCES);
    expect(refs?.at(-1)).toMatchObject({ content: 'c', documentId: 'doc-0' });
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('keeps the latest user turn during a multi-step tool loop and ignores echoed tags', async () => {
    const lookup = vi.fn(async () => ({ content: 'Body' }));

    const refs = await resolveDocumentReferences(
      [
        { content: '<refer_document name="New" id="doc-new" />', role: 'user' },
        { content: 'Echo <refer_document name="New" id="doc-new" />', role: 'assistant' },
        { content: '<refer_document name="Other" id="doc-other" />', role: 'tool' },
      ],
      lookup,
    );

    expect(refs).toEqual([{ content: 'Body', documentId: 'doc-new', title: 'New' }]);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('inlines earlier-turn documents when asked to', async () => {
    const lookup = vi.fn(async (id: string) => ({ content: `Body ${id}` }));

    const refs = await resolveDocumentReferences(
      [
        { content: '<refer_document name="Old" id="doc-old" />', role: 'user' },
        { content: 'Follow-up', role: 'user' },
      ],
      lookup,
      { inlineEarlierTurns: true },
    );

    expect(refs).toEqual([{ content: 'Body doc-old', documentId: 'doc-old', title: 'Old' }]);
  });

  it('caps the number of inlined documents to the most recent ones', async () => {
    const count = MAX_DOCUMENT_REFERENCES + 2;
    const content = Array.from(
      { length: count },
      (_, i) => `<refer_document name="D${i}" id="doc-${i}" />`,
    ).join(' ');
    const lookup = vi.fn(async () => ({ content: 'c' }));

    const refs = await resolveDocumentReferences([{ content, role: 'user' }], lookup);

    expect(refs).toHaveLength(MAX_DOCUMENT_REFERENCES);
    expect(refs?.[0].documentId).toBe('doc-2');
    expect(lookup).toHaveBeenCalledTimes(MAX_DOCUMENT_REFERENCES);
  });
});

describe('resolveDocumentReferencesByMessage', () => {
  it('returns undefined without tags', async () => {
    const lookup = vi.fn();
    expect(
      await resolveDocumentReferencesByMessage([{ content: 'plain' }], lookup),
    ).toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('keys a reference to its own message with a live lookup result', async () => {
    const lookup = vi.fn(async () => ({ content: 'Body', title: 'Current' }));
    const refs = await resolveDocumentReferencesByMessage(
      [
        { content: '<refer_document name="Old" id="doc-1" />', id: 'user-1', role: 'user' },
        { content: 'Follow-up', id: 'user-2', role: 'user' },
      ],
      lookup,
    );

    expect(refs).toEqual([
      {
        content: 'Body',
        documentId: 'doc-1',
        messageId: 'user-1',
        messageIndex: 0,
        title: 'Current',
      },
    ]);
  });

  it('resolves the same document again for a later request with fresh content', async () => {
    const versions = ['First version', 'Second version'];
    const lookup = vi.fn(async () => ({ content: versions.shift() ?? 'Unknown' }));
    const messages = [
      { content: '<refer_document id="doc-1" />', id: 'user-1', role: 'user' },
      { content: 'Next', id: 'user-2', role: 'user' },
    ];

    const first = await resolveDocumentReferencesByMessage(messages, lookup);
    const second = await resolveDocumentReferencesByMessage(messages, lookup);

    expect(first?.[0]).toMatchObject({ content: 'First version', messageId: 'user-1' });
    expect(second?.[0]).toMatchObject({ content: 'Second version', messageId: 'user-1' });
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('keeps a missing or forbidden document unavailable on its own message', async () => {
    const refs = await resolveDocumentReferencesByMessage(
      [{ content: '<refer_document id="doc-gone" />', id: 'user-1', role: 'user' }],
      async () => null,
    );

    expect(refs).toEqual([
      { documentId: 'doc-gone', messageId: 'user-1', messageIndex: 0, title: undefined },
    ]);
  });

  it('bounds each message by the document cap and truncates to the character budget', async () => {
    const ids = Array.from({ length: MAX_DOCUMENT_REFERENCES + 2 }, (_, i) => `doc-${i}`);
    const content = ids.map((id) => `<refer_document id="${id}" />`).join(' ');
    const lookup = vi.fn(async () => ({ content: 'x'.repeat(MAX_DOCUMENT_REFERENCE_CHARS + 5) }));

    const refs = await resolveDocumentReferencesByMessage(
      [{ content, id: 'user-1', role: 'user' }],
      lookup,
    );

    expect(refs).toHaveLength(MAX_DOCUMENT_REFERENCES);
    expect(refs?.every((ref) => ref.content?.length === MAX_DOCUMENT_REFERENCE_CHARS)).toBe(true);
    expect(refs?.every((ref) => ref.truncated === true)).toBe(true);
    expect(lookup).toHaveBeenCalledTimes(MAX_DOCUMENT_REFERENCES);
  });

  it('does not let assistant or tool echoes claim a reference', async () => {
    const lookup = vi.fn(async () => ({ content: 'Body' }));
    const refs = await resolveDocumentReferencesByMessage(
      [
        { content: '<refer_document id="doc-1" />', id: 'user-1', role: 'user' },
        { content: '<refer_document id="doc-fake" />', id: 'a-1', role: 'assistant' },
        { content: '<refer_document id="doc-tool" />', id: 't-1', role: 'tool' },
      ],
      lookup,
    );

    expect(refs?.map((ref) => ref.documentId)).toEqual(['doc-1']);
    expect(lookup).toHaveBeenCalledTimes(1);
  });
});
