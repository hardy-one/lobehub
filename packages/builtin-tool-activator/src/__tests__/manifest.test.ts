import { describe, expect, it } from 'vitest';

import { systemPrompt } from '../systemRole';

describe('LobeActivatorManifest lean-prompt toggle', () => {
  it('teaches credential activation and injection without advertising removed plaintext access', () => {
    expect(systemPrompt).toContain('<credentials_management>');
    expect(systemPrompt).not.toContain('getPlaintextCred');
    expect(systemPrompt).toContain('injectCredsToSandbox');
    expect(systemPrompt).toContain('no tool exposed to read a saved credential');
    expect(systemPrompt).toContain('credentials');
  });
});
