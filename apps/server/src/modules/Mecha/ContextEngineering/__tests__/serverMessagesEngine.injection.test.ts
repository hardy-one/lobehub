import { InjectionSnapshotStore } from '@lobechat/context-engine';
import { type UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { serverMessagesEngine } from '../index';

const createdAt = Date.parse('2026-11-22T00:00:00Z');

const messages = (): UIChatMessage[] => [
  {
    content: 'Keep my preferences in mind.',
    createdAt,
    id: 'msg-user-1',
    role: 'user',
    updatedAt: createdAt,
  } as UIChatMessage,
];

const userMemory = (description: string) => ({
  enabled: true,
  fetchedAt: 1,
  memories: {
    contexts: [{ description, id: 'ctx-1', title: 'Current context' }],
  },
});

const injectedContent = (result: Awaited<ReturnType<typeof serverMessagesEngine>>): string =>
  result.messages
    .map((message) => (typeof message.content === 'string' ? message.content : ''))
    .find((content) => content.includes('<contexts')) ?? '';

describe('serverMessagesEngine - session-scoped injection snapshots', () => {
  it('solidifies the first-user block and reuses it on the next operation', async () => {
    const store = new InjectionSnapshotStore();
    const base = {
      enableTimeReminder: false,
      messages: messages(),
      model: 'gpt-4',
      provider: 'openai',
      topicId: 'tpc_injection_reuse',
    };

    const first = await serverMessagesEngine({
      ...base,
      injectionSnapshotStore: store,
      userMemory: userMemory('first-memory-A'),
    });
    // The source changes between operations. With a session snapshot the first
    // value still wins, which is the only way to prove the store reached the
    // injector rather than being dropped at the server boundary.
    const second = await serverMessagesEngine({
      ...base,
      injectionSnapshotStore: store,
      userMemory: userMemory('second-memory-B'),
    });

    expect(injectedContent(first)).toContain('first-memory-A');
    expect(injectedContent(second)).toContain('first-memory-A');
    expect(injectedContent(second)).not.toContain('second-memory-B');
    expect(injectedContent(second)).toBe(injectedContent(first));
    expect(store.has('tpc_injection_reuse:firstUser:userMemory')).toBe(true);
  });

  it('keeps per-operation assembly when the host supplies no store (control)', async () => {
    const base = {
      enableTimeReminder: false,
      messages: messages(),
      model: 'gpt-4',
      provider: 'openai',
      topicId: 'tpc_no_store',
    };

    await serverMessagesEngine({ ...base, userMemory: userMemory('control-memory-A') });
    const second = await serverMessagesEngine({
      ...base,
      userMemory: userMemory('control-memory-B'),
    });

    expect(injectedContent(second)).toContain('control-memory-B');
    expect(injectedContent(second)).not.toContain('control-memory-A');
  });
});
