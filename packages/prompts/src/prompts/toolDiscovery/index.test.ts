import { describe, expect, it } from 'vitest';

import { availableToolPrompt, availableToolsPrompts } from './index';

describe('availableToolsPrompts', () => {
  const longTool = {
    description:
      'Manage user credentials for authentication, environment variable injection, and API verification. Use this tool when tasks require API keys, OAuth tokens, or secrets - such as calling third-party APIs, authenticating with external services.',
    identifier: 'lobe-creds',
    name: 'Credentials',
  };

  it('lean mode truncates descriptions to ~80 chars', () => {
    const result = availableToolsPrompts([longTool], true);
    expect(result).toContain('lobe-creds');
    expect(result).toContain('…');
    const desc = result.match(/lobe-creds[^>]*>([\s\S]*?)<\/tool>/)?.[1] ?? '';
    expect(desc.length).toBeLessThanOrEqual(81);
    expect(desc).not.toContain('OAuth tokens');
  });

  it('full mode keeps the complete description', () => {
    const result = availableToolsPrompts([longTool]);
    expect(result).toContain('OAuth tokens');
    expect(result).not.toContain('…');
  });

  it('returns empty string for empty tools', () => {
    expect(availableToolsPrompts([])).toBe('');
    expect(availableToolsPrompts([], true)).toBe('');
  });

  it('availableToolPrompt renders identifier/name/description', () => {
    const result = availableToolPrompt(longTool);
    expect(result).toContain('identifier="lobe-creds"');
    expect(result).toContain('name="Credentials"');
    expect(result).toContain('Manage user credentials');
  });
});
