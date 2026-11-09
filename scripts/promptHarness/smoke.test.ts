import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  canonicalHash,
  extractEnvironmentSnapshot,
  findSensitiveHeader,
  hashBaselineRequest,
  hashPromptRequest,
  redactHeaders,
} from './canonical';
import { buildDatabaseUrl, parseDatabaseUrl } from './database';
import { readDocumentWindowNotice } from './documentWindow';
import {
  getScenario,
  HARNESS_AGENT_PROMPT,
  HARNESS_BASELINE_USER_MESSAGE,
  NEXT_REPLY_LANGUAGE_SUFFIX,
  nextReplyLanguageSystemRole,
  PROMPT_SCENARIOS,
} from './fixtures';
import { assertHarnessPort } from './ports';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('prompt harness smoke', () => {
  it('defines every required scenario and a byte-identical legacy/on-demand pair', () => {
    const required = [
      'baseline-chat',
      'baseline-legacy',
      'baseline-on-demand',
      'document',
      'long-document',
      'manual-skill',
      'memory',
      'memory-expertise',
      'memory-follow-up',
      'negative-activation',
      'skill',
      'skill-activation',
      'tool-activation',
      'ui-intervention',
    ];

    expect(PROMPT_SCENARIOS.map((scenario) => scenario.id).sort()).toEqual(required);
    expect(getScenario('baseline-chat').prompt).toBe(HARNESS_BASELINE_USER_MESSAGE);
    expect(getScenario('baseline-legacy').prompt).toBe(HARNESS_BASELINE_USER_MESSAGE);
    expect(getScenario('baseline-on-demand').prompt).toBe(HARNESS_BASELINE_USER_MESSAGE);
    expect(getScenario('baseline-chat').agentId).not.toBe(getScenario('baseline-legacy').agentId);
    expect(getScenario('baseline-legacy').agentId).not.toBe(
      getScenario('baseline-on-demand').agentId,
    );

    const seed = readFileSync(
      path.join(repoRoot, 'scripts/promptHarness/fixtures/seed.sql'),
      'utf8',
    );
    expect(seed.match(/User-authored Agent Prompt/g) ?? []).toHaveLength(3);
    expect(seed).toContain('agt_yLie7JpbUr2K');
    expect(seed).toContain('agt_T101LEGACY01');
    expect(seed).toContain('agt_T106CHAT01');
    expect(seed).not.toContain('t100-domain-approved');
    expect(getScenario('memory-expertise').beforeFixturePaths).toEqual([
      'scripts/promptHarness/fixtures/memoryExpertise.sql',
    ]);
    expect(getScenario('memory-expertise').afterFixturePaths).toBeUndefined();
    expect(getScenario('memory-follow-up').afterFixturePaths).toEqual([
      'scripts/promptHarness/fixtures/memoryExpertiseCleanup.sql',
    ]);
    expect(HARNESS_AGENT_PROMPT.startsWith('  User-authored Agent Prompt\n\t')).toBe(true);
    expect(NEXT_REPLY_LANGUAGE_SUFFIX).toBe(
      '\n\nPreferred reply language: en-US. Use this language unless the user explicitly asks to switch.',
    );
    expect(nextReplyLanguageSystemRole('prompt')).toBe(`prompt${NEXT_REPLY_LANGUAGE_SUFFIX}`);
  });

  it('canonicalizes object keys but preserves message and tool array order', () => {
    const left = { messages: [{ content: 'same', role: 'user' }], tools: [{ b: 2, a: 1 }] };
    const right = { tools: [{ a: 1, b: 2 }], messages: [{ role: 'user', content: 'same' }] };
    const changed = {
      messages: [{ role: 'user', content: 'different' }],
      tools: [{ a: 1, b: 2 }],
    };

    expect(hashPromptRequest(left)).toEqual(hashPromptRequest(right));
    expect(hashPromptRequest(left).messages).not.toBe(hashPromptRequest(changed).messages);
    expect(canonicalHash({ a: 1, b: 2 })).toBe(canonicalHash({ b: 2, a: 1 }));
  });

  it('excludes environment-derived blocks from the stable baseline hash and snapshots them', () => {
    const build = (tools: string[], agents: string[]) => ({
      messages: [
        {
          content: `<user_memory>\nkeep me\n</user_memory>\n<available_tools description="installed">\n${tools.join('\n')}\n</available_tools>\n<agent_management_context>\n${agents.join('\n')}\n</agent_management_context>`,
          role: 'system',
        },
        { content: 'keep the user turn', role: 'user' },
      ],
      tools: [{ a: 1 }],
    });

    const first = build(['- lobe-browser', '- lobe-local-system'], ['- T106UI01', '- T106NEGATIVE01']);
    const drifted = build(
      ['- lobe-local-system', '- lobe-browser'],
      ['- T106NEGATIVE01', '- T106UI01', '- T106NEW01'],
    );

    // The raw messages hash drifts with the environment-derived blocks...
    expect(hashPromptRequest(first).messages).not.toBe(hashPromptRequest(drifted).messages);
    // ...but the stable baseline hash ignores them.
    expect(hashBaselineRequest(first)).toEqual(hashBaselineRequest(drifted));

    // The excluded blocks are still recorded (sorted, de-duplicated) for provenance.
    expect(extractEnvironmentSnapshot(first).availableTools).toEqual([
      '- lobe-browser',
      '- lobe-local-system',
    ]);
    expect(extractEnvironmentSnapshot(first).availableAgents).toEqual([
      '- T106NEGATIVE01',
      '- T106UI01',
    ]);

    // Bytes the PR actually controls still move the stable hash.
    const changedTurn = {
      ...first,
      messages: [first.messages[0], { content: 'keep the user turn!', role: 'user' }],
    };
    expect(hashBaselineRequest(first).messages).not.toBe(hashBaselineRequest(changedTurn).messages);
  });

  it('redacts every credential-bearing header without touching request data', () => {
    const fixtureValue = ['redaction', 'fixture'].join('-');
    const redactedMark = ['REDACTED'].join('');
    const raw = {
      'Authorization': `Bearer ${fixtureValue}`,
      'Cookie': `session=${fixtureValue}`,
      'content-type': 'application/json',
      'X-Api-Key': fixtureValue,
    };

    expect(findSensitiveHeader(raw)).toBe('Authorization');
    expect(redactHeaders(raw)).toEqual({
      'Authorization': `[${redactedMark}]`,
      'Cookie': `[${redactedMark}]`,
      'content-type': 'application/json',
      'X-Api-Key': `[${redactedMark}]`,
    });
    expect(findSensitiveHeader(redactHeaders(raw))).toBeUndefined();
  });

  it('reads the real document continuation notice without requiring a metadata envelope', () => {
    const notice = readDocumentWindowNotice(
      '[Showing lines 1-1197 of 2201 lines, 368493 characters. To continue, call readDocument again with id="doc-1", format="markdown" and offset=1198.]',
    );

    expect(notice).toEqual({
      endLine: 1197,
      nextOffset: 1198,
      startLine: 1,
      totalChars: 368493,
      totalLines: 2201,
    });
    expect(readDocumentWindowNotice('complete document')).toBeUndefined();
  });

  it('rejects shared ports and preserves database credentials when cloning the URL', () => {
    expect(() => assertHarnessPort(3010)).toThrow('Refusing shared/development port');
    expect(() => assertHarnessPort(3311)).toThrow('Refusing shared/development port');
    expect(assertHarnessPort(43_211)).toBe(43_211);

    const fixtureValue = ['db', 'fixture'].join('-');
    const parts = parseDatabaseUrl(
      `postgresql://test_user:${fixtureValue}@127.0.0.1:5433/source_db`,
    );
    expect(parts).toMatchObject({
      database: 'source_db',
      host: '127.0.0.1',
      port: '5433',
      user: 'test_user',
    });
    const cloned = buildDatabaseUrl(parts, 't105_clone');
    expect(cloned).toContain(`test_user:${fixtureValue}@`);
    expect(cloned.endsWith('/t105_clone')).toBe(true);
  });

  it('uses a lock, ephemeral ports and process-group teardown in the stack entrypoint', () => {
    const script = readFileSync(path.join(repoRoot, 'scripts/promptHarness/stack.sh'), 'utf8');
    expect(script).toContain('flock -n 9');
    expect(script).toContain('PROMPT_HARNESS_ENV=test');
    expect(script).toContain('source .env');
    expect(script).not.toContain('_dangerous_local_dev_proxy');
  });
});
