import { describe, expect, it } from 'vitest';

import { InjectionSnapshotStore } from '../../injection/InjectionSnapshotStore';
import type { PipelineContext } from '../../types';
import type { TodoList } from '../TodoInjector';
import { TodoInjector } from '../TodoInjector';

const createContext = (): PipelineContext => ({
  initialState: { messages: [] },
  isAborted: false,
  messages: [
    {
      content: 'Help me track the launch checklist',
      createdAt: 1_700_000_000_000,
      id: 'user-real-1',
      role: 'user',
      updatedAt: 1_700_000_000_000,
    },
  ],
  metadata: {},
});

const todos = (marker: string): TodoList => ({
  items: [
    { status: 'completed', text: `DONE ${marker}` },
    { status: 'processing', text: `WIP ${marker}` },
    { status: 'todo', text: `NEXT ${marker}` },
  ],
  updatedAt: `time-${marker}`,
});

const inject = (store: InjectionSnapshotStore, list: TodoList) =>
  new TodoInjector({
    enabled: true,
    snapshotStore: store,
    todos: list,
    topicId: 'tpc_todo_refresh',
  }).process(createContext());

describe('TodoInjector', () => {
  it('shows the current todos after the list changes between operations', async () => {
    const store = new InjectionSnapshotStore();

    const first = await inject(store, todos('A'));
    const second = await inject(store, todos('B'));

    expect(String(first.messages.at(-1)?.content)).toContain('DONE A');

    const current = String(second.messages.at(-1)?.content);
    expect(current).toContain('DONE B');
    expect(current).not.toContain('DONE A');
    expect(second.metadata.todoInjectionId).not.toBe(first.metadata.todoInjectionId);
  });
});
