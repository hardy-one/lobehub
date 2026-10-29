import { describe, expect, it } from 'vitest';

import { normalizeThinkTags, processWithArtifact } from '../utils/markdown';

/**
 * `usePreparedMessage` is a `useMemo` around exactly this pair, so the pair is
 * what the caching has to keep faithful. These cases pin the rewriting that the
 * render body used to run unconditionally.
 */
const prepare = (content: string) => normalizeThinkTags(processWithArtifact(content));

describe('prepared message (usePreparedMessage body)', () => {
  it('strips newlines inside a lobeArtifact so the tag stays one raw HTML node', () => {
    const input = '<lobeArtifact type="html">\n<div>\nhi\n</div>\n</lobeArtifact>';

    expect(prepare(input)).toBe('<lobeArtifact type="html"><div>hi</div></lobeArtifact>');
  });

  it('normalizes newlines around a leading think tag', () => {
    const input = '<think>reasoning</think>answer';

    expect(prepare(input)).toBe('<think>\n\nreasoning\n\n</think>\n\nanswer');
  });

  it('leaves a mid-message think tag untouched', () => {
    // A model quoting the tag in prose must not grow a collapsible block.
    const input = 'Quoting `<think>` here stays literal.';

    expect(prepare(input)).toBe(input);
  });

  it('collapses runs of blank lines to a single blank line', () => {
    const input = '<think>a</think>\n\n\n\n\nbody';

    expect(prepare(input)).not.toContain('\n\n\n');
  });

  it('is identity for plain text', () => {
    const input = 'A normal reply with **markdown** and no tags.';

    expect(prepare(input)).toBe(input);
  });

  it('keeps a streamed, still-open artifact from swallowing the rest', () => {
    // The `/g` artifact matcher must not eat text after an unclosed tag while
    // the message is still streaming.
    const input = '<lobeArtifact type="html">\n<div>partial';

    expect(prepare(input)).not.toContain('\n');
  });
});
