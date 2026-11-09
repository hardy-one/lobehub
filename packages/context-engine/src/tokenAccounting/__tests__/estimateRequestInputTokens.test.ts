import { describe, expect, it } from 'vitest';

import { estimateRequestInputTokens } from '../estimateRequestInputTokens';

describe('estimateRequestInputTokens', () => {
  it('counts string content, tool_calls and tool schemas', () => {
    const base = estimateRequestInputTokens([{ content: 'hello', role: 'user' }]);
    const withToolCall = estimateRequestInputTokens([
      { content: 'hello', role: 'user' },
      {
        content: '',
        role: 'assistant',
        tool_calls: [{ function: { arguments: '{"q":"x"}', name: 'search' }, id: 'call-1' }],
      },
      { content: 'result', role: 'tool', tool_call_id: 'call-1' },
    ]);
    const withTools = estimateRequestInputTokens([{ content: 'hello', role: 'user' }], {
      tools: [{ function: { description: 'x'.repeat(4000), name: 'big', parameters: {} } }],
    });

    expect(withToolCall).toBeGreaterThan(base);
    expect(withTools).toBeGreaterThan(base);
  });

  it('charges multimodal parts by estimate, not by raw JSON length', () => {
    const textOnly = estimateRequestInputTokens([
      { content: [{ text: 'hi', type: 'text' }], role: 'user' },
    ]);
    const withImage = estimateRequestInputTokens([
      {
        content: [
          { text: 'hi', type: 'text' },
          { image_url: { url: 'data:image/png;base64,' + 'A'.repeat(100_000) }, type: 'image_url' },
        ],
        role: 'user',
      },
    ]);

    // The huge base64 string must not be serialized into the count.
    expect(withImage - textOnly).toBe(1000);
  });
});
