import { systemPrompt } from '@lobechat/builtin-tool-local-system';
import { renderPlaceholderTemplate } from '@lobechat/context-engine';
import { describe, expect, it } from 'vitest';

import { createVariableGenerators } from '../variableGenerators';

const renderLocalSystemRole = (variables: Record<string, string>): string =>
  renderPlaceholderTemplate(systemPrompt, {
    ...createVariableGenerators({ now: () => new Date('2026-01-01T00:00:00Z') }),
    ...variables,
  });

/** The block the model reads when deciding which machine its tools act on. */
const contextBlock = (rendered: string): string => {
  const start = rendered.indexOf('<user_context>');
  const end = rendered.indexOf('</user_context>');

  return rendered.slice(start, end + '</user_context>'.length);
};

describe('local-system device context', () => {
  it('tells two bound devices apart by name and capacity', () => {
    const first = contextBlock(
      renderLocalSystemRole({
        hardware: 'Acme X1 Processor (8 logical cores), 16 GB RAM, 512 GB disk',
        hostname: 'build-node-01',
        workingDirectory: '/home/ci/workspace',
      }),
    );
    const second = contextBlock(
      renderLocalSystemRole({
        hardware: 'Gizmo II (4 logical cores), 8 GB RAM, 256 GB disk',
        hostname: 'build-node-02',
        workingDirectory: '/srv/checkout',
      }),
    );

    expect(first).toContain('**Device:** build-node-01');
    expect(first).toContain(
      '**Hardware:** Acme X1 Processor (8 logical cores), 16 GB RAM, 512 GB disk',
    );
    expect(second).toContain('**Device:** build-node-02');
    expect(second).toContain('**Hardware:** Gizmo II (4 logical cores), 8 GB RAM, 256 GB disk');
    expect(first).not.toBe(second);
  });

  it('falls back instead of leaking the tokens when no device reported anything', () => {
    const rendered = contextBlock(renderLocalSystemRole({}));

    expect(rendered).toContain('**Device:** unknown');
    expect(rendered).toContain('**Hardware:** (not reported)');
    expect(rendered).not.toMatch(/\{\{\w+\}\}/);
  });
});
