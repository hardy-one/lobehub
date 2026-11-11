import { describe, expect, it } from 'vitest';

import { compactSystemPrompt, getSystemPromptForShareVisitor } from './systemRole';

describe('activator systemRole', () => {
  it('keeps the trigger conditions the model needs to reach the skill store', () => {
    expect(compactSystemPrompt).toContain('SKILL.md');
    expect(compactSystemPrompt).toContain('lobehub.com/skills/{identifier}');
    expect(compactSystemPrompt).toContain('importFromMarket');
    expect(compactSystemPrompt).toContain('activate `lobe-skill-store`');
  });

  it('keeps the trigger conditions for credentials', () => {
    expect(compactSystemPrompt).toContain('API key');
    expect(compactSystemPrompt).toContain('OAuth');
    expect(compactSystemPrompt).toContain('injectCredsToSandbox');
    expect(compactSystemPrompt).toMatch(/paste a key into chat/i);
  });

  it('still carries the sandbox-reachability placeholder the facts layer resolves', () => {
    expect(compactSystemPrompt).toContain('{{creds_sandbox_reachable}}');
  });

  it('keeps each trigger section to a handful of conditions', () => {
    // The long-form details live in the tools' own systemRole, which the model
    // reads after activating them. The activator only has to say when to go.
    const section = (tag: string) =>
      compactSystemPrompt.match(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`))?.[0] ?? '';

    expect(section('skill_store_discovery').length).toBeLessThan(900);
    expect(section('credentials_management').length).toBeLessThan(1100);
  });

  it('drops the duplicated install ladder that the skill-store manual owns', () => {
    expect(compactSystemPrompt).not.toContain('Install priority');
    expect(compactSystemPrompt).not.toContain('market-cli');
  });

  it('omits the store and credential sections for a share visitor', () => {
    const visitor = getSystemPromptForShareVisitor({ withSkills: true });

    expect(visitor).not.toContain('lobe-skill-store');
    expect(visitor).not.toContain('lobe-creds');
    expect(visitor).toContain('activateSkill');
  });
});
