import { describe, expect, it } from 'vitest';

import type { UIChatMessage } from '@/types/index';

import { MessagesEngine } from '../MessagesEngine';
import type { MessagesEngineParams } from '../types';

const createMessages = (): UIChatMessage[] => [
  {
    content: 'Check this article',
    createdAt: 1_700_000_000_000,
    id: 'msg-1',
    role: 'user',
    updatedAt: 1_700_000_000_000,
  } as UIChatMessage,
];

const createParams = (overrides?: Partial<MessagesEngineParams>): MessagesEngineParams => ({
  messages: createMessages(),
  model: 'gemini-4-neon',
  provider: 'lobehub',
  skillsConfig: {
    enabledSkills: [
      {
        description: 'Run statistical tests',
        identifier: 'stat-skill',
        name: 'Statistical Analysis',
      },
    ],
  },
  systemRole: 'You are a helpful assistant.',
  timezone: 'Asia/Shanghai',
  ...overrides,
});

describe('MessagesEngine date injection stability', () => {
  it.each(['lobe-web-browsing', 'lobe-user-memory'])(
    'keeps the leading system prefix free of a wall-clock date and byte-stable when %s is activated mid-run',
    async (toolId) => {
      const before = await new MessagesEngine(
        createParams({
          toolsConfig: {
            manifests: [],
            tools: ['lobe-activator'],
          },
        }),
      ).process();

      const after = await new MessagesEngine(
        createParams({
          toolsConfig: {
            manifests: [
              {
                api: [{ description: 'Run tool', name: 'run', parameters: {} }],
                identifier: toolId,
                meta: { title: toolId },
                systemRole: 'Use this tool carefully.',
                type: 'builtin',
              },
            ],
            tools: ['lobe-activator', toolId],
          },
        }),
      ).process();

      const beforeSystem = before.messages[0].content as string;
      const afterSystem = after.messages[0].content as string;

      // The system prompt carries no wall-clock date any more; time lives in the
      // per-turn <time_reminder> block instead, so activation cannot mutate the
      // leading system prefix.
      expect(beforeSystem).not.toContain('Current date:');
      expect(afterSystem).not.toContain('Current date:');
      expect(afterSystem.startsWith(beforeSystem)).toBe(true);
    },
  );

  it('renders no wall-clock date in the system prompt even with an eval attempt clock', async () => {
    const result = await new MessagesEngine(
      createParams({ evalContext: { sessionDate: '2026-11-21T12:00:00Z' } }),
    ).process();

    expect(result.messages[0].content as string).not.toContain('Current date:');
  });

  it('still respects explicit enableSystemDate: false by suppressing the time reminder', async () => {
    const result = await new MessagesEngine(
      createParams({
        enableSystemDate: false,
      }),
    ).process();

    const userMessage = result.messages.find((message) => message.role === 'user');
    expect(String(userMessage?.content)).not.toContain('<time_reminder>');
  });
});
