import { describe, expect, it } from 'vitest';

import type { MessageDispatch } from '../reducer';
import { mayBreakToolLinks } from './reconcileTools';

const dispatch = (payload: Partial<MessageDispatch> & { type: MessageDispatch['type'] }) =>
  payload as MessageDispatch;

describe('mayBreakToolLinks', () => {
  // The invariant reconcileAssistantToolLinks restores can only be broken by a
  // dispatch that moves rows or rewrites an assistant's tools[]. Anything else
  // leaves an already-consistent bucket consistent.
  it('scans when rows are added or removed', () => {
    expect(
      mayBreakToolLinks(dispatch({ id: 'm1', type: 'createMessage', value: {} as never })),
    ).toBe(true);
    expect(mayBreakToolLinks(dispatch({ id: 'm1', type: 'deleteMessage' }))).toBe(true);
    expect(mayBreakToolLinks(dispatch({ ids: ['m1'], type: 'deleteMessages' }))).toBe(true);
    expect(mayBreakToolLinks(dispatch({ type: 'updateMessages', value: [] }))).toBe(true);
  });

  it('scans when an update carries tools, and never for one that does not', () => {
    expect(
      mayBreakToolLinks(
        dispatch({ id: 'm1', type: 'updateMessage', value: { tools: [] } as never }),
      ),
    ).toBe(true);
    expect(
      mayBreakToolLinks(dispatch({ id: 'm1', type: 'updateMessage', value: { content: 'hi' } })),
    ).toBe(false);
  });

  it('scans when tools are edited on an assistant', () => {
    expect(
      mayBreakToolLinks(
        dispatch({ id: 'm1', tool_call_id: 't1', type: 'deleteMessageTool' } as never),
      ),
    ).toBe(true);
    expect(
      mayBreakToolLinks(
        dispatch({ id: 'm1', tool_call_id: 't1', type: 'updateMessageTools', value: {} } as never),
      ),
    ).toBe(true);
    expect(
      mayBreakToolLinks(dispatch({ id: 'm1', type: 'addMessageTool', value: {} } as never)),
    ).toBe(true);
  });

  it('skips the scan for streamed content, reasoning and plugin state', () => {
    for (const type of [
      'updateMessageMetadata',
      'updateMessageExtra',
      'updatePluginState',
      'updateMessagePlugin',
      'replaceMessagePluginState',
    ] as const) {
      expect(mayBreakToolLinks(dispatch({ id: 'm1', type } as never))).toBe(false);
    }
  });
});
