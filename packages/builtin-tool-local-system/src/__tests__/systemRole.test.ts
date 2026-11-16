import { describe, expect, it } from 'vitest';

import { systemPrompt } from '../systemRole';

describe('systemRole template', () => {
  it('pairs {{defaultShell}} with {{shellSyntaxGuidance}}', () => {
    expect(systemPrompt).toContain('{{defaultShell}}');
    expect(systemPrompt).toContain('{{shellSyntaxGuidance}}');
  });

  it('teaches image reads and the localFile response format', () => {
    expect(systemPrompt).toContain('Image files are uploaded as visual tool results');
    expect(systemPrompt).toContain('base64');
    expect(systemPrompt).toContain('<localFile');
  });

  /**
   * Both placeholders need a generator on every host that renders this
   * template (server pipeline, mecha defaults, desktop placeholder map);
   * a host without one leaks the literal `{{…}}` token into the prompt.
   */
  it('names the device and its static capacity', () => {
    expect(systemPrompt).toContain('**Device:** {{hostname}}');
    expect(systemPrompt).toContain('**Hardware:** {{hardware}}');
  });
});
