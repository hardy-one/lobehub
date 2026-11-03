import { describe, expect, it } from 'vitest';

import { ToolNameResolver } from '../ToolNameResolver';

describe('ToolNameResolver on-demand scope', () => {
  it('should preserve known fully-qualified names for the downstream scope guard', () => {
    const resolver = new ToolNameResolver();
    const toolCalls = [
      {
        function: { arguments: '{"expression":"1 + 1"}', name: 'lobe-calculator____calculate' },
        id: 'call_1',
        type: 'function',
      },
    ];
    const manifests = {
      'lobe-activator': {
        api: [{ description: '', name: 'activateTools', parameters: {} }],
        identifier: 'lobe-activator',
        meta: {},
        type: 'builtin' as const,
      },
      'lobe-calculator': {
        api: [{ description: '', name: 'calculate', parameters: {} }],
        identifier: 'lobe-calculator',
        meta: {},
        type: 'builtin' as const,
      },
    };

    const result = resolver.resolve(toolCalls, manifests, ['lobe-activator____activateTools']);

    expect(result).toEqual([
      {
        apiName: 'calculate',
        arguments: '{"expression":"1 + 1"}',
        id: 'call_1',
        identifier: 'lobe-calculator',
        thoughtSignature: undefined,
        type: 'builtin',
      },
    ]);
  });
});
