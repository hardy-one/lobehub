import { INJECTION_SOURCE_KEYS } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import type { UIChatMessage } from '@/types/index';

import { AgentDocumentMessageInjector } from '../../../providers';
import { MessagesEngine } from '../MessagesEngine';
import type { MessagesEngineParams } from '../types';

/**
 * Append-only v2 dual-path reads (slice 4a).
 *
 * A registered persisted-injection source has two mutually exclusive assembly
 * paths, chosen per request by the data itself:
 * - timeline has no row for the source → the legacy injector produces it;
 * - timeline has a row for the source → the row is replayed in place and the
 *   legacy injector must stay silent.
 */

const AGENT_DOC_MESSAGE = INJECTION_SOURCE_KEYS.AGENT_DOC_MESSAGE;

const at = 1_700_000_000_000;

const msg = (partial: object): UIChatMessage =>
  ({ createdAt: at, updatedAt: at, ...partial }) as UIChatMessage;

const documents = [
  {
    content: 'After-first-user memo',
    filename: 'after.md',
    loadPosition: 'after-first-user' as const,
    loadRules: { rule: 'always' as const },
    policyLoad: 'always' as const,
  },
  {
    content: 'Context-end memo',
    filename: 'end.md',
    loadPosition: 'context-end' as const,
    loadRules: { rule: 'always' as const },
    policyLoad: 'always' as const,
  },
];

const timeline = (): UIChatMessage[] => [
  msg({ content: 'Hello', id: 'u1', role: 'user' }),
  msg({ content: 'Hi there', id: 'a1', role: 'assistant' }),
  msg({ content: 'Follow-up', id: 'u2', role: 'user' }),
];

const baseParams = (messages: UIChatMessage[]): MessagesEngineParams => ({
  agentDocuments: documents,
  enableSystemDate: false,
  messages,
  model: 'gpt-4',
  provider: 'openai',
  systemRole: 'You are a helpful assistant.',
});

/** Run the legacy L1 injector on the same timeline to get its exact output. */
const legacyAgentDocMessages = async () => {
  const result = await new AgentDocumentMessageInjector({
    documents,
    enabled: true,
  }).process({
    initialState: { messages: [] },
    isAborted: false,
    messages: timeline(),
    metadata: {},
  });

  return result.messages;
};

describe('MessagesEngine persisted-injection dual path (agent_doc_message)', () => {
  it('pins the canonical source key', () => {
    expect(INJECTION_SOURCE_KEYS.AGENT_DOC_MESSAGE).toBe('agent_doc_message');
  });

  it('replays persisted rows in timeline order instead of re-running the injector', async () => {
    const generated = await new MessagesEngine(baseParams(timeline())).process();

    const legacy = await legacyAgentDocMessages();
    const afterFirstUser = legacy[1];
    const contextEnd = legacy.at(-1)!;

    const replayed = await new MessagesEngine(
      baseParams([
        timeline()[0],
        {
          ...afterFirstUser,
          createdAt: at + 1,
          isInjection: true,
          sourceKey: AGENT_DOC_MESSAGE,
        },
        timeline()[1],
        timeline()[2],
        {
          ...contextEnd,
          createdAt: at + 2,
          isInjection: true,
          sourceKey: AGENT_DOC_MESSAGE,
        },
      ]),
    ).process();

    expect(replayed.messages).toEqual(generated.messages);
  });

  it('never emits the same agent-document block twice', async () => {
    const legacy = await legacyAgentDocMessages();
    const afterFirstUser = legacy[1];
    const contextEnd = legacy.at(-1)!;

    const replayed = await new MessagesEngine(
      baseParams([
        timeline()[0],
        {
          ...afterFirstUser,
          createdAt: at + 1,
          isInjection: true,
          sourceKey: AGENT_DOC_MESSAGE,
        },
        timeline()[1],
        timeline()[2],
        {
          ...contextEnd,
          createdAt: at + 2,
          isInjection: true,
          sourceKey: AGENT_DOC_MESSAGE,
        },
      ]),
    ).process();

    const serialized = JSON.stringify(replayed.messages);
    expect(serialized.match(/After-first-user memo/g)).toHaveLength(1);
    expect(serialized.match(/Context-end memo/g)).toHaveLength(1);
  });

  it('keeps unrelated sources on their legacy injectors', async () => {
    const params = (messages: UIChatMessage[]): MessagesEngineParams => ({
      ...baseParams(messages),
      planTodo: {
        enabled: true,
        injectTodos: true,
        plan: {
          completed: false,
          createdAt: '2026-03-01T00:00:00.000Z',
          description: 'Ship slice 4a',
          goal: 'Dual-path reads',
          id: 'plan-1',
          updatedAt: '2026-03-01T00:00:00.000Z',
        },
        todos: {
          items: [{ status: 'todo', text: 'record PG evidence' }],
          updatedAt: '2026-03-01T00:00:00.000Z',
        },
      },
    });

    const generated = await new MessagesEngine(params(timeline())).process();

    const legacy = await legacyAgentDocMessages();
    const legacyAfterFirstUser = legacy[1];
    const legacyContextEnd = legacy.at(-1)!;

    const replayed = await new MessagesEngine(
      params([
        timeline()[0],
        {
          ...legacyAfterFirstUser,
          createdAt: at + 1,
          isInjection: true,
          sourceKey: AGENT_DOC_MESSAGE,
        },
        timeline()[1],
        timeline()[2],
        {
          ...legacyContextEnd,
          createdAt: at + 2,
          isInjection: true,
          sourceKey: AGENT_DOC_MESSAGE,
        },
      ]),
    ).process();

    const serialized = JSON.stringify(replayed.messages);
    const serializedGenerated = JSON.stringify(generated.messages);
    // The legacy path still produced the agent docs when nothing was persisted.
    expect(serializedGenerated).toContain('After-first-user memo');
    expect(serializedGenerated).toContain('record PG evidence');
    // The agent-doc source switched to replay...
    expect(serialized.match(/After-first-user memo/g)).toHaveLength(1);
    // ...while the un-migrated plan/todo source still runs its legacy injector,
    // exactly once.
    expect(serialized).toContain('record PG evidence');
    expect(serialized.match(/Dual-path reads/g)).toHaveLength(1);
    // A replayed row keeps its stored timeline anchor instead of re-deriving
    // `after-first-user` after synthetic first-user injection.
    const firstUser = replayed.messages.findIndex(
      (message) => message.role === 'user' && message.content === 'Hello',
    );
    const docRow = replayed.messages.findIndex(
      (message) =>
        message.role === 'system' &&
        typeof message.content === 'string' &&
        message.content.includes('After-first-user memo'),
    );
    expect(docRow).toBe(firstUser + 1);
  });

  it('keeps the legacy L1 output byte-identical when no persisted row exists', async () => {
    const result = await new MessagesEngine(baseParams(timeline())).process();

    expect(result.messages).toMatchSnapshot();
  });
});
