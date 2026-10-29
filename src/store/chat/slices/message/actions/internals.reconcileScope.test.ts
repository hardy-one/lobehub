import type { ConversationContext, UIChatMessage } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/store/chat';

import { resetTranscripts, rowsOf, seedRows } from './testUtils';

const CTX: ConversationContext = { agentId: 'agent-1', topicId: 'topic-1' };

const assistant = (id: string, tools: UIChatMessage['tools'] = []): UIChatMessage =>
  ({ id, content: '', role: 'assistant', tools }) as UIChatMessage;

const toolRow = (id: string, parentId: string): UIChatMessage =>
  ({
    id,
    content: '',
    parentId,
    plugin: { apiName: 'readFile', arguments: '{}', identifier: 'lobe-local-system' },
    role: 'tool',
    tool_call_id: `call-${id}`,
  }) as UIChatMessage;

// The parent assistant lost its `tools[]` entry while the tool row and its
// parentId survived — the shape reconcileAssistantToolLinks repairs.
const orphanedRows = () => [assistant('asst-1', []), toolRow('tool-1', 'asst-1')];

describe('internal_dispatchMessage — tool link reconciliation scope', () => {
  beforeEach(() => {
    resetTranscripts();
    useChatStore.setState({ activeAgentId: 'agent-1', activeTopicId: 'topic-1' }, false);
  });

  it('re-links an orphaned tool row when the dispatch can touch tools', () => {
    seedRows(CTX, orphanedRows());
    const { result } = renderHook(() => useChatStore());

    act(() => {
      result.current.internal_dispatchMessage(
        { id: 'asst-1', type: 'updateMessage', value: { tools: [] } },
        CTX,
      );
    });

    expect(
      rowsOf(CTX)
        ?.find((row) => row.id === 'asst-1')
        ?.tools?.map((t) => t.id),
    ).toEqual(['call-tool-1']);
  });

  // A text/reasoning chunk cannot move a tool row or rewrite `tools[]`, so the
  // bucket it leaves behind is still consistent. Asserting the row is untouched
  // pins the skip: before the guard this path rebuilt the link on every chunk.
  it('leaves the bucket alone for a content-only dispatch', () => {
    seedRows(CTX, orphanedRows());
    const { result } = renderHook(() => useChatStore());

    act(() => {
      result.current.internal_dispatchMessage(
        { id: 'asst-1', type: 'updateMessage', value: { content: 'streamed' } },
        CTX,
      );
    });

    const updated = rowsOf(CTX)?.find((row) => row.id === 'asst-1');
    expect(updated?.content).toBe('streamed');
    expect(updated?.tools).toEqual([]);
  });

  it('still reconciles when a row is created', () => {
    seedRows(CTX, [assistant('asst-1', [])]);
    const { result } = renderHook(() => useChatStore());

    act(() => {
      result.current.internal_dispatchMessage(
        { id: 'tool-1', type: 'createMessage', value: toolRow('tool-1', 'asst-1') },
        CTX,
      );
    });

    expect(
      rowsOf(CTX)
        ?.find((row) => row.id === 'asst-1')
        ?.tools?.map((t) => t.id),
    ).toEqual(['call-tool-1']);
  });

  it('does not write to the transcript when nothing changed', () => {
    seedRows(CTX, [assistant('asst-1', [])]);
    const { result } = renderHook(() => useChatStore());

    const commitSpy = vi.spyOn(result.current, 'internal_getConversationContext');

    act(() => {
      // Same content, same tools: the deep compare must stop the write.
      result.current.internal_dispatchMessage(
        { id: 'asst-1', type: 'updateMessage', value: { content: '' } },
        CTX,
      );
    });

    expect(commitSpy).toHaveBeenCalled();
    expect(rowsOf(CTX)).toHaveLength(1);
  });
});
