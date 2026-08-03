import { describe, expect, it } from 'vitest';

import { coreSystemPrompt, systemPrompt } from './systemRole';

describe('systemRole lean-prompt toggle (exportFile teaching)', () => {
  it('full prompt keeps all 4 exportFile teaching occurrences', () => {
    // <core_capabilities> item 5
    expect(systemPrompt).toContain(
      '5. Export files generated during skill execution to cloud storage (exportFile)',
    );
    // <workflow> item 6
    expect(systemPrompt).toContain(
      '6. If the skill execution generates output files, use exportFile to save them for the user',
    );
    // <tool_selection_guidelines> block
    expect(systemPrompt).toContain(
      '- **exportFile**: Call this to export files generated during skill execution',
    );
    // <best_practices> line
    expect(systemPrompt).toContain(
      '- Use exportFile when the skill generates output files that need to be saved',
    );
    expect(systemPrompt.match(/exportFile/g)).toHaveLength(4);
  });

  it('lean prompt drops exportFile teaching entirely', () => {
    expect(coreSystemPrompt.match(/exportFile/g)).toBeNull();
    expect(coreSystemPrompt).not.toContain('cloud storage (exportFile)');
    expect(coreSystemPrompt).not.toContain('- **exportFile**:');
  });

  it('lean prompt keeps the rest of the skills teaching', () => {
    expect(coreSystemPrompt).toContain('activateSkill');
    expect(coreSystemPrompt).toContain('readReference');
    expect(coreSystemPrompt).toContain('execScript');
    expect(coreSystemPrompt).toContain('runcommand_vs_execscript');
  });
});
