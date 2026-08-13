import { describe, expect, it } from 'vitest';

import { type SkillItem, skillPrompt, skillsPrompts } from './index';

describe('skillPrompt', () => {
  it('should generate skill tag with location', () => {
    const skill: SkillItem = {
      description: 'Extracts text and tables from PDF files',
      identifier: 'pdf-processing',
      location: '/path/to/skills/pdf-processing/SKILL.md',
      name: 'PDF Processing',
    };

    expect(skillPrompt(skill)).toBe(
      '  <skill name="PDF Processing" location="/path/to/skills/pdf-processing/SKILL.md">Extracts text and tables from PDF files</skill>',
    );
  });

  it('should generate skill tag without location', () => {
    const skill: SkillItem = {
      description: 'Custom skill description',
      identifier: 'my-skill',
      name: 'My Skill',
    };

    expect(skillPrompt(skill)).toBe('  <skill name="My Skill">Custom skill description</skill>');
  });
});

describe('skillsPrompts', () => {
  it('should generate available_skills block with multiple skills', () => {
    const skills: SkillItem[] = [
      {
        description: 'Extracts text and tables from PDF files',
        identifier: 'pdf-processing',
        location: '/path/to/skills/pdf-processing/SKILL.md',
        name: 'PDF Processing',
      },
      {
        description: 'Analyzes datasets and generates charts',
        identifier: 'data-analysis',
        location: '/path/to/skills/data-analysis/SKILL.md',
        name: 'Data Analysis',
      },
    ];

    const expected = `<available_skills>
  <skill name="PDF Processing" location="/path/to/skills/pdf-processing/SKILL.md">Extracts text and tables from PDF files</skill>
  <skill name="Data Analysis" location="/path/to/skills/data-analysis/SKILL.md">Analyzes datasets and generates charts</skill>
</available_skills>

Use the runSkill tool to activate a skill when needed.`;

    expect(skillsPrompts(skills)).toBe(expected);
  });

  it('should generate mixed skills with and without location', () => {
    const skills: SkillItem[] = [
      {
        description: 'Generate interactive UI components',
        identifier: 'artifacts',
        location: '/path/to/skills/artifacts/SKILL.md',
        name: 'Artifacts',
      },
      {
        description: 'Custom skill description',
        identifier: 'my-skill',
        name: 'My Skill',
      },
    ];

    const expected = `<available_skills>
  <skill name="Artifacts" location="/path/to/skills/artifacts/SKILL.md">Generate interactive UI components</skill>
  <skill name="My Skill">Custom skill description</skill>
</available_skills>

Use the runSkill tool to activate a skill when needed.`;

    expect(skillsPrompts(skills)).toBe(expected);
  });

  it('should return empty string for empty skills array', () => {
    expect(skillsPrompts([])).toBe('');
  });
});

describe('skillsPrompts lean mode', () => {
  const longSkill = {
    description:
      'MUST USE when user wants to research/search/look up/find anything on the internet — 15 platforms, multi-backend routing, zero config for 6 channels. NOT for writing reports.',
    identifier: 'agent-reach',
    location: '/home/u/.agents/skills/agent-reach/SKILL.md',
    name: 'agent-reach',
    source: 'device' as const,
  };

  it('lean mode truncates long descriptions to ~120 chars', () => {
    const result = skillsPrompts([longSkill], true);
    expect(result).toContain('agent-reach');
    expect(result).toContain('…');
    expect(result).toContain('research/search');
    // keeps the trigger keywords at the start
    const desc = result.match(/agent-reach[^>]*>([\s\S]*?)<\/skill>/)?.[1] ?? '';
    expect(desc.length).toBeLessThanOrEqual(121);
    expect(desc).not.toContain('NOT for writing reports');
  });

  it('full mode keeps the complete description', () => {
    const result = skillsPrompts([longSkill]);
    expect(result).toContain('NOT for writing reports');
    expect(result).not.toContain('…');
  });
});
