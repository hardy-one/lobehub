import { describe, expect, it } from 'vitest';

import { systemPrompt } from '../systemRole';

describe('LobeActivatorManifest lean-prompt toggle', () => {
  it('full systemPrompt is byte-identical to the legacy prompt (contains credentials teaching)', () => {
    expect(systemPrompt).toContain('<credentials_management>');
    expect(systemPrompt).toContain('getPlaintextCred');
    expect(systemPrompt).toContain('credentials');
  });
});
