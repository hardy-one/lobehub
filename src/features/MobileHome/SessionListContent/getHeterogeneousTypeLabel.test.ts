import { describe, expect, it } from 'vitest';

import { getHeterogeneousTypeLabel } from './getHeterogeneousTypeLabel';

describe('getHeterogeneousTypeLabel', () => {
  it('uses the friendly label for a known runtime', () => {
    expect(getHeterogeneousTypeLabel('claude-code')).toBe('Claude Code');
  });

  it('keeps unknown runtime identifiers visible', () => {
    expect(getHeterogeneousTypeLabel('custom-runtime')).toBe('custom-runtime');
  });

  it('does not render a tag for regular agents', () => {
    expect(getHeterogeneousTypeLabel()).toBeUndefined();
    expect(getHeterogeneousTypeLabel(null)).toBeUndefined();
  });
});
