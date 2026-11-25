import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { TimeReminderInjector } from '../../providers/TimeReminderInjector';
import type { PipelineContext } from '../../types';
import { InputTemplateProcessor } from '../InputTemplate';
import { MessageContentProcessor } from '../MessageContent';
import { PlaceholderVariablesProcessor } from '../PlaceholderVariables';
import { ReactionFeedbackProcessor } from '../ReactionFeedback';
import { StaleToolResultTrimProcessor } from '../StaleToolResultTrim';

/**
 * Integration across every processor that touched in the 0-B/0-B2 injection
 * work: a text injection row must keep its exact bytes and its v2 markers
 * while the real user turn around it is still processed normally.
 */
const createContext = (messages: UIChatMessage[]): PipelineContext => ({
  initialState: { messages: [] } as any,
  isAborted: false,
  messages,
  metadata: { model: 'gpt-4', provider: 'openai', maxTokens: 100_000 },
});

const now = Date.now();
const injectionContent = ' {{topic_id}} memo — literal  spaces  🏷️';

const injectionRow = {
  content: injectionContent,
  createdAt: now,
  id: 'inj-1',
  isInjection: true,
  parentId: 'u1',
  role: 'user',
  sourceKey: 'agent-document-message',
  updatedAt: now,
} as UIChatMessage;

const messages = (): UIChatMessage[] =>
  [
    {
      content: 'Hello',
      createdAt: now,
      id: 'u1',
      role: 'user',
      updatedAt: now,
    },
    {
      content: 'Hi there',
      createdAt: now,
      id: 'a1',
      metadata: { reactions: [{ count: 1, emoji: '👍', users: ['user1'] }] },
      role: 'assistant',
      updatedAt: now,
    },
    injectionRow,
    {
      content: 'Next question',
      createdAt: now,
      id: 'u2',
      role: 'user',
      updatedAt: now,
    },
  ] as UIChatMessage[];

describe('v2 injection row across the processor pipeline', () => {
  it('keeps content bytes, isInjection, sourceKey and parentId after all processors', async () => {
    let context = createContext(messages());
    const processors = [
      new InputTemplateProcessor({ inputTemplate: 'T: {{text}}' }),
      new TimeReminderInjector({ enabled: true, timezone: 'UTC' }),
      new StaleToolResultTrimProcessor({ keepRecentMessages: 3, minTotalToolChars: 0 }),
      new PlaceholderVariablesProcessor({ variableGenerators: { topic_id: () => 'hydrated' } }),
      new ReactionFeedbackProcessor({ enabled: true }),
      new MessageContentProcessor({
        fileContext: { enabled: false },
        isCanUseVision: () => false,
        model: 'gpt-4',
        provider: 'openai',
      }),
    ];

    for (const processor of processors) context = await processor.process(context);

    const row = context.messages.find((message) => message.id === 'inj-1');
    expect(row).toBeDefined();
    expect(Buffer.from(String(row!.content), 'utf8')).toEqual(
      Buffer.from(injectionContent, 'utf8'),
    );
    expect(row!.isInjection).toBe(true);
    expect(row!.sourceKey).toBe('agent-document-message');
    expect(row!.parentId).toBe('u1');

    const realUser = context.messages.at(-1)!;
    expect(String(realUser.content)).toContain('[User Feedback Emoji: 👍]');
    expect(String(context.messages[0].content)).toContain('T: Hello');
  });
});
