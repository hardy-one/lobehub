import { estimateTokenCount } from 'tokenx';
import { describe, expect, it } from 'vitest';

import { MessagesEngine } from '../../engine/messages';
import { countContextBuckets } from '../contextBuckets';

describe('countContextBuckets', () => {
  it('splits the payload into the four UI buckets and sums to the total', async () => {
    const engine = new MessagesEngine({
      capabilities: { isCanUseFC: () => true },
      historySummary: 'User asked about token accounting.',
      messages: [
        { content: 'Hello', id: '1', role: 'user' as const, createdAt: 0, updatedAt: 0 },
        { content: 'Hi there!', id: '2', role: 'assistant' as const, createdAt: 0, updatedAt: 0 },
        {
          content: 'What is the context size?',
          id: '3',
          role: 'user' as const,
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      model: 'gpt-4',
      provider: 'openai',
      systemRole: 'You are a helpful assistant.',
    });

    const result = await engine.process();
    const buckets = result.metadata.contextBuckets;
    expect(buckets).toBeDefined();

    const counts = countContextBuckets(result.messages, buckets!);

    // The three recorded buckets cover the system-prompt blocks.
    expect(counts.systemRole).toBeGreaterThan(0);
    expect(counts.tools).toBe(0); // no tools in this run
    expect(counts.historySummary).toBeGreaterThan(0);

    // chats = total − recorded buckets; the four always sum to the total.
    expect(counts.chats).toBeGreaterThan(0);
    expect(counts.systemRole + counts.tools + counts.historySummary + counts.chats).toBeGreaterThan(
      0,
    );
  });

  it('records tool teaching blocks into the tools bucket', async () => {
    const engine = new MessagesEngine({
      capabilities: { isCanUseFC: () => true },
      messages: [
        { content: 'List my tools', id: '4', role: 'user' as const, createdAt: 0, updatedAt: 0 },
      ],
      model: 'gpt-4',
      provider: 'openai',
      systemRole: 'You are a helpful assistant.',
      toolsConfig: {
        manifests: [
          {
            api: [
              { description: 'Get the weather for a city', name: 'getWeather', parameters: {} },
            ],
            identifier: 'weather',
            meta: { title: 'Weather' },
            systemRole: 'You can look up the weather.',
            type: 'builtin' as const,
          },
        ],
        tools: ['weather'],
      },
    });

    const result = await engine.process();
    const buckets = result.metadata.contextBuckets!;

    expect(buckets.tools).toContain('Weather');
    expect(buckets.tools).toContain('You can look up the weather.');
    expect(buckets.systemRole).toContain('You are a helpful assistant.');

    // Function schemas are passed separately (they live in the LLM `tools`
    // parameter, not in the message list) and fold into the tools bucket.
    const counts = countContextBuckets(result.messages, buckets, [
      { function: { description: 'Get the weather for a city', name: 'getWeather' } },
    ]);
    expect(counts.tools).toBeGreaterThan(estimateTokenCount(buckets.tools));
    expect(counts.chats).toBeGreaterThan(0);
  });

  it('records the lean-mode <available_tools> discovery list into the tools bucket', async () => {
    const engine = new MessagesEngine({
      availableTools: [
        { description: 'Search the web', identifier: 'lobe-web-browsing', name: 'Web Browsing' },
        { description: 'Manage credentials', identifier: 'lobe-creds', name: 'Credentials' },
      ],
      capabilities: { isCanUseFC: () => true },
      messages: [{ content: 'hi', id: '1', role: 'user' as const, createdAt: 0, updatedAt: 0 }],
      model: 'gpt-4',
      promptMode: 'lean',
      provider: 'openai',
      systemRole: 'You are a helpful assistant.',
    });

    const result = await engine.process();
    const buckets = result.metadata.contextBuckets!;

    // Same bucket as <available_skills> — tool discovery rides the tools bucket.
    expect(buckets.tools).toContain('<available_tools>');
    expect(buckets.tools).toContain('lobe-web-browsing');
    expect(buckets.tools).toContain('lobe-creds');
    expect(buckets.systemRole).not.toContain('<available_tools>');
  });

  it('buckets eval + bot-platform instructions into tools (system-side, not profile/summary)', async () => {
    const engine = new MessagesEngine({
      botPlatformContext: {
        platformName: 'wechat',
        supportsMarkdown: false,
      } as never,
      capabilities: { isCanUseFC: () => true },
      evalContext: { envPrompt: 'You are being evaluated. Follow the rubric.' },
      messages: [{ content: 'hi', id: '1', role: 'user' as const, createdAt: 0, updatedAt: 0 }],
      model: 'gpt-4',
      provider: 'openai',
      systemRole: 'You are a helpful assistant.',
    });

    const result = await engine.process();
    const buckets = result.metadata.contextBuckets!;

    expect(buckets.tools).toContain('You are being evaluated.');
    expect(buckets.tools).toContain('wechat');
    expect(buckets.systemRole).not.toContain('You are being evaluated.');
  });

  it('buckets runtime context fragments (stable prefix) into tools', async () => {
    const engine = new MessagesEngine({
      additionalContexts: [
        {
          content: {
            sections: [],
            text: '<run_guidance>current date: 2026-08-27</run_guidance>',
            type: 'text',
          },
          placement: 'stable_prefix',
          wrapper: { tag: 'run_guidance' },
        },
      ],
      capabilities: { isCanUseFC: () => true },
      messages: [{ content: 'hi', id: '1', role: 'user' as const, createdAt: 0, updatedAt: 0 }],
      model: 'gpt-4',
      provider: 'openai',
      systemRole: 'You are a helpful assistant.',
    });

    const result = await engine.process();
    const buckets = result.metadata.contextBuckets!;

    expect(buckets.tools).toContain('current date: 2026-08-27');
    expect(buckets.chats).not.toContain('current date: 2026-08-27');
  });

  it('buckets the force-finish summary row into tools', async () => {
    const engine = new MessagesEngine({
      capabilities: { isCanUseFC: () => true },
      forceFinish: true,
      messages: [{ content: 'hi', id: '1', role: 'user' as const, createdAt: 0, updatedAt: 0 }],
      model: 'gpt-4',
      provider: 'openai',
      systemRole: 'You are a helpful assistant.',
    });

    const result = await engine.process();
    const buckets = result.metadata.contextBuckets!;

    expect(buckets.tools).toContain('maximum step limit');
    expect(buckets.chats).not.toContain('maximum step limit');
  });

  it('buckets onboarding action hints into chats (they ride the last user row)', async () => {
    const engine = new MessagesEngine({
      capabilities: { isCanUseFC: () => true },
      messages: [{ content: 'hi', id: '1', role: 'user' as const, createdAt: 0, updatedAt: 0 }],
      model: 'gpt-4',
      onboardingContext: {
        phaseGuidance: 'First, choose a model for this workspace, then create your first agent.',
      },
      provider: 'openai',
      systemRole: 'You are a helpful assistant.',
    });

    const result = await engine.process();
    const buckets = result.metadata.contextBuckets!;

    // The action-hint row (<next_actions> virtual last-user message) rides the
    // conversation rows — chats, not tools.
    expect(buckets.chats).toContain('SOUL.md is empty');
    expect(buckets.chats).toContain('PERSISTENCE RULE');
    expect(buckets.tools).not.toContain('PERSISTENCE RULE');
  });

  it('keeps persona out of the chats bucket — a single hello stays small', async () => {
    const engine = new MessagesEngine({
      capabilities: { isCanUseFC: () => true },
      messages: [{ content: 'hello', id: '1', role: 'user' as const, createdAt: 0, updatedAt: 0 }],
      model: 'gpt-4',
      provider: 'openai',
      systemRole: 'You are a helpful assistant.',
      userMemory: {
        enabled: true,
        memories: {
          contexts: [],
          experiences: [],
          identities: [{ content: 'I am a senior engineer', title: 'Engineer' }],
          persona: { narrative: 'I love building tools.', tagline: 'Builder' },
          preferences: [],
        },
      },
    });

    const result = await engine.process();
    const buckets = result.metadata.contextBuckets!;
    const counts = countContextBuckets(result.messages, buckets);

    // Persona (<user_memory>) lives in the tools bucket, not chats and not
    // systemRole — it describes the operator alongside the toolbox.
    expect(buckets.tools).toContain('I love building tools.');
    expect(buckets.systemRole).not.toContain('I love building tools.');
    expect(counts.tools).toBeGreaterThan(0);

    // chats ≈ the single 'hello' row only.
    expect(counts.chats).toBeLessThanOrEqual(estimateTokenCount('hello') + 4);
  });

  it('buckets learned expertise (<expertise>) into the tools bucket', async () => {
    const engine = new MessagesEngine({
      capabilities: { isCanUseFC: () => true },
      enableExpertise: true,
      expertise: {
        contentHash: 'stable-hash',
        domains: [{ id: 'dom_1', lessonIds: ['les_1'] }],
        renderedContext: '<expertise><domain id="research">research expertise</domain></expertise>',
        schemaVersion: 1,
      },
      messages: [{ content: 'hi', id: '1', role: 'user' as const, createdAt: 0, updatedAt: 0 }],
      model: 'gpt-4',
      provider: 'openai',
      systemRole: 'You are a helpful assistant.',
    });

    const result = await engine.process();
    const buckets = result.metadata.contextBuckets!;
    const counts = countContextBuckets(result.messages, buckets);

    expect(buckets.tools).toContain('<expertise>');
    expect(buckets.systemRole).not.toContain('<expertise>');
    expect(counts.tools).toBeGreaterThan(0);

    // Expertise rides the injection row, so it must not leak into chats.
    expect(buckets.chats).toBe('hi');
  });

  it('records the full conversation (assistant + tool rows) into the chats base', async () => {
    const engine = new MessagesEngine({
      capabilities: { isCanUseFC: () => true },
      messages: [
        { content: 'list files', id: '1', role: 'user' as const, createdAt: 0, updatedAt: 0 },
        {
          content: '',
          id: '2',
          role: 'assistant' as const,
          createdAt: 0,
          updatedAt: 0,
          tools: [
            { id: 'call_1', type: 'function' as const, function: { name: 'ls', arguments: '' } },
          ],
        },
        {
          content: 'file-a\nfile-b',
          id: '3',
          role: 'tool' as const,
          createdAt: 0,
          updatedAt: 0,
        },
        { content: 'done', id: '4', role: 'assistant' as const, createdAt: 0, updatedAt: 0 },
      ],
      model: 'gpt-4',
      provider: 'openai',
      systemRole: 'You are a helpful assistant.',
    });

    const result = await engine.process();
    const buckets = result.metadata.contextBuckets!;
    const counts = countContextBuckets(result.messages, buckets);

    // chats = input[2] onwards: user + assistant + tool rows all count.
    expect(buckets.chats).toContain('list files');
    expect(buckets.chats).toContain('file-a\nfile-b');
    expect(buckets.chats).toContain('done');
    expect(counts.chats).toBeGreaterThanOrEqual(estimateTokenCount(buckets.chats) - 1);
  });

  it('buckets agent-management context into the profile, not chats', async () => {
    const engine = new MessagesEngine({
      agentManagementContext: {
        availableAgents: [{ description: 'A helper agent', id: 'agt_1', name: 'Helper' }],
      } as never,
      capabilities: { isCanUseFC: () => true },
      messages: [{ content: 'hi', id: '1', role: 'user' as const, createdAt: 0, updatedAt: 0 }],
      model: 'gpt-4',
      provider: 'openai',
      systemRole: 'You are a helpful assistant.',
    });

    const result = await engine.process();
    const buckets = result.metadata.contextBuckets!;

    // The agent list lands in the profile bucket (it is environment context,
    // not a conversation row) — verified against probe 0022, where the
    // <agent_management_context> block was being miscounted as chats.
    expect(buckets.systemRole).toContain('<agent_management_context>');
    expect(buckets.chats).toBe('hi');
  });
});
