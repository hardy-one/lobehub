import { describe, expect, it } from 'vitest';

import { buildSystemRole, HTML_RENDER_PROMPT } from './htmlRenderPrompt';

describe('buildSystemRole', () => {
  it('should return the system role untouched when the feature is disabled', () => {
    const role = 'You are a helpful assistant.';

    expect(buildSystemRole(role, false)).toBe(role);
    expect(buildSystemRole(role, undefined)).toBe(role);
  });

  it('should return only the preset when enabled without a configured system role', () => {
    expect(buildSystemRole(undefined, true)).toBe(HTML_RENDER_PROMPT);
  });

  it('should append the preset after the configured system role when enabled', () => {
    const role = 'You are a helpful assistant.';
    const result = buildSystemRole(role, true);

    expect(result).toBe(`${role}\n\n${HTML_RENDER_PROMPT}`);
  });

  it('should not append the preset twice when the system role already contains it', () => {
    const roleWithPreset = `You are a helpful assistant.\n\n${HTML_RENDER_PROMPT}`;

    expect(buildSystemRole(roleWithPreset, true)).toBe(roleWithPreset);
    // partial/customized preset text still dedupes via the start marker
    expect(buildSystemRole('custom\n<!-- html-render-start -->\nmore', true)).toBe(
      'custom\n<!-- html-render-start -->\nmore',
    );
  });
});
