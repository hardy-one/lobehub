import { describe, expect, it } from 'vitest';

import { getTokenTagMode } from './tokenTagMode';

describe('getTokenTagMode', () => {
  it('stamps agent mode with full prompt for Smart', () => {
    expect(getTokenTagMode(true, 'full')).toBe('agent:full');
  });

  it('stamps agent mode with lean prompt for Efficient', () => {
    expect(getTokenTagMode(true, 'lean')).toBe('agent:lean');
  });

  it('stamps chat mode for Chat (full prompt)', () => {
    expect(getTokenTagMode(false, 'full')).toBe('chat:full');
  });

  it('treats undefined enableAgentMode as agent mode', () => {
    expect(getTokenTagMode(undefined, 'full')).toBe('agent:full');
  });

  it('defaults promptMode to full', () => {
    expect(getTokenTagMode(true, undefined)).toBe('agent:full');
  });
});
