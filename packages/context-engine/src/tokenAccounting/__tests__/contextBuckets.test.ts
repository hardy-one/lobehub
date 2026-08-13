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

    // Persona lives in the assistant-profile bucket, not chats.
    expect(buckets.systemRole).toContain('I love building tools.');
    expect(counts.systemRole).toBeGreaterThan(0);

    // chats ≈ the single 'hello' row only.
    expect(counts.chats).toBeLessThanOrEqual(estimateTokenCount('hello') + 4);
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
