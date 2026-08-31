import { describe, expect, it } from 'vitest';

import { extractContextReferences, mergeContextReferences } from './contextReferences';

describe('contextReferences', () => {
  it('extracts references from a serialized Lexical document in order', () => {
    const first = { content: 'A', id: 'a', source: 'text' as const, type: 'text' as const };
    const second = { content: 'B', id: 'b', source: 'text' as const, type: 'text' as const };

    const editorData = {
      root: {
        children: [
          { children: [{ text: 'before', type: 'text' }], type: 'paragraph' },
          { selection: first, type: 'context-reference' },
          { children: [{ text: 'middle', type: 'text' }], type: 'paragraph' },
          { selection: second, type: 'context-reference' },
        ],
        type: 'root',
      },
    };

    expect(extractContextReferences(editorData)).toEqual([first, second]);
  });

  it('deduplicates external and inline references by id', () => {
    const first = { content: 'A', id: 'same', source: 'text' as const, type: 'text' as const };
    const second = { content: 'B', id: 'other', source: 'text' as const, type: 'text' as const };

    expect(mergeContextReferences([first], [first, second])).toEqual([first, second]);
  });
});
