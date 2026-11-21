import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { SelectedSkillInjector } from '../SelectedSkillInjector';

const createContext = (messages: any[] = []): PipelineContext => ({
  initialState: {
    messages: [],
    model: 'gpt-4',
    provider: 'openai',
  },
  isAborted: false,
  messages,
  metadata: {
    maxTokens: 4096,
    model: 'gpt-4',
  },
});

describe('SelectedSkillInjector', () => {
  // T-195 批 B / C3: skills are projected to a deterministic tail slot instead of
  // being appended into the last real user message, so per-operation churn stays
  // out of the [0,k) prefix. The original user messages must remain untouched.
  it('should project selected skills to a tail slot, leaving the last user message untouched', async () => {
    const provider = new SelectedSkillInjector({
      selectedSkills: [
        { identifier: 'user_memory', name: 'User Memory' },
        { identifier: 'instruction', name: 'Instruction' },
      ],
    });

    const context = createContext([
      { content: 'Earlier question', id: 'user-1', role: 'user' },
      { content: 'Assistant reply', id: 'assistant-1', role: 'assistant' },
      { content: 'Current request', id: 'user-2', role: 'user' },
    ]);

    const result = await provider.process(context);

    // original 3 messages unchanged + 1 deterministic tail slot
    expect(result.messages).toHaveLength(4);
    expect(result.messages[2].content).toBe('Current request');
    const tail = result.messages[3].content as string;
    expect(tail).toContain('<selected_skill_context>');
    expect(tail).toContain('<selected_skills>');
    expect(tail).toContain('<skill identifier="user_memory" name="User Memory" />');
    expect((result.messages[3] as any).meta.virtualLastUser).toBe(true);
    expect(result.metadata.selectedSkillContext).toEqual({
      injected: true,
      skillsCount: 2,
    });
  });

  it('should inject skill content inline in the tail slot when available', async () => {
    const provider = new SelectedSkillInjector({
      selectedSkills: [
        {
          content: 'Use grep to search the codebase.\n\n## Usage\ngrep pattern file',
          identifier: 'grep',
          name: 'Grep',
        },
        { identifier: 'translate', name: 'Translate' },
      ],
    });

    const context = createContext([{ content: 'Search for foo', id: 'user-1', role: 'user' }]);

    const result = await provider.process(context);
    // index 0 = untouched real user, index 1 = tail slot
    expect(result.messages[0].content).toBe('Search for foo');
    const content = result.messages[1].content as string;

    // Skill with content: open/close tag with content inside
    expect(content).toContain('<skill identifier="grep" name="Grep">');
    expect(content).toContain('Use grep to search the codebase.');
    expect(content).toContain('</skill>');
    // Skill without content: self-closing tag
    expect(content).toContain('<skill identifier="translate" name="Translate" />');
  });

  it('should carry a single SYSTEM CONTEXT wrapper in the tail slot without touching an existing wrapper on the user message', async () => {
    const provider = new SelectedSkillInjector({
      selectedSkills: [{ identifier: 'user_memory', name: 'User Memory' }],
    });

    const existingUserContent = `Current request

<!-- SYSTEM CONTEXT (NOT PART OF USER QUERY) -->
<current_page_context>
<page>draft</page>
</current_page_context>
<!-- END SYSTEM CONTEXT -->`;
    const context = createContext([
      {
        content: existingUserContent,
        id: 'user-1',
        role: 'user',
      },
    ]);

    const result = await provider.process(context);
    // The real user message keeps its original wrapper byte-for-byte.
    expect(result.messages[0].content).toBe(existingUserContent);
    const tail = result.messages[1].content as string;
    expect(tail.match(/<!-- SYSTEM CONTEXT \(NOT PART OF USER QUERY\) -->/g)).toHaveLength(1);
    expect(tail).toContain('<selected_skill_context>');
    expect(tail).not.toContain('<current_page_context>');
  });
});
