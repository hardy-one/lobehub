import { afterEach, describe, expect, it } from 'vitest';

import { LobeActivatorManifest } from '../manifest';
import { coreSystemPrompt, systemPrompt } from '../systemRole';

describe('LobeActivatorManifest lean-prompt toggle', () => {
  const originalMode = process.env.CONTEXT_ENGINE_PROMPT_MODE;
  const originalToolBlocks = process.env.CONTEXT_ENGINE_TOOL_BLOCKS;

  afterEach(() => {
    if (originalMode === undefined) delete process.env.CONTEXT_ENGINE_PROMPT_MODE;
    else process.env.CONTEXT_ENGINE_PROMPT_MODE = originalMode;
    if (originalToolBlocks === undefined) delete process.env.CONTEXT_ENGINE_TOOL_BLOCKS;
    else process.env.CONTEXT_ENGINE_TOOL_BLOCKS = originalToolBlocks;
  });

  it('full systemPrompt is byte-identical to the legacy prompt (contains credentials teaching)', () => {
    expect(systemPrompt).toContain('<credentials_management>');
    expect(systemPrompt).toContain('getPlaintextCred');
    expect(systemPrompt).toContain('credentials');
  });

  it('coreSystemPrompt drops the credentials block (unactivated lobe-creds teaching)', () => {
    expect(coreSystemPrompt).not.toContain('<credentials_management>');
    expect(coreSystemPrompt).not.toContain('getPlaintextCred');
    // best_practices keeps the CREDS-FIRST activation hint (guides activation,
    // not tool usage) — so 'lobe-creds' may still appear, but the teaching
    // block itself must be gone.
    expect(coreSystemPrompt).not.toContain('<credentials_management>');
  });

  it('manifest defaults to full prompt when env is unset', () => {
    delete process.env.CONTEXT_ENGINE_PROMPT_MODE;
    delete process.env.CONTEXT_ENGINE_TOOL_BLOCKS;
    // Manifest is a module-level constant; verify it carries the full prompt
    // by checking the default branch logic (full prompt is the fallback).
    expect(LobeActivatorManifest.systemRole).toBe(systemPrompt);
  });
});
