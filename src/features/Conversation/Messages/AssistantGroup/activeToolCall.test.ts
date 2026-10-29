import { describe, expect, it } from 'vitest';

import { resolveExecutingToolCallIds } from './activeToolCall';

const call = (id: string, result?: { content?: string; error?: unknown }) =>
  ({
    apiName: 'readFile',
    arguments: '{}',
    id,
    identifier: 'lobe-local-system',
    result,
  }) as never;

const running = (...ids: string[]) => new Set(ids);

describe('resolveExecutingToolCallIds', () => {
  it('marks only the unfinished tail when no operation reports a call as running', () => {
    const tools = [call('call-1'), call('call-2'), call('call-3')];

    expect(resolveExecutingToolCallIds(tools, true, new Set())).toEqual(['call-3']);
  });

  it('skips rows that already settled so a finished tail does not hide the running call', () => {
    const tools = [call('call-1'), call('call-2'), call('call-3', { content: 'ok' })];

    expect(resolveExecutingToolCallIds(tools, true, new Set())).toEqual(['call-2']);
  });

  // A batch only runs serially where an API is `ordered` or two calls name the
  // same serialized resource; everything else starts at once. Picking the last
  // unfinished row alone left a concurrently running row static.
  it('marks every call an operation reports as running, not just the tail', () => {
    const tools = [call('call-1'), call('call-2'), call('call-3')];

    expect(resolveExecutingToolCallIds(tools, true, running('call-1', 'call-2'))).toEqual([
      'call-1',
      'call-2',
    ]);
  });

  it('trusts the reported running call and does not guess an unreported tail', () => {
    // Once operations track calls one by one, an unfinished row without a
    // running operation already finished without a merged result. Falling back
    // to the tail here would light it up forever.
    const tools = [call('call-1'), call('call-2'), call('call-3')];

    expect(resolveExecutingToolCallIds(tools, true, running('call-1'))).toEqual(['call-1']);
  });

  it('never resurrects a settled row that somehow still has a running operation', () => {
    const tools = [call('call-1', { content: 'ok' }), call('call-2')];

    expect(resolveExecutingToolCallIds(tools, true, running('call-1', 'call-2'))).toEqual([
      'call-2',
    ]);
  });

  it('falls back to the unfinished tail while the running ids are unresolved', () => {
    const tools = [call('call-1'), call('call-2')];

    expect(resolveExecutingToolCallIds(tools, true, undefined)).toEqual(['call-2']);
  });

  it('treats a result with only a length as settled', () => {
    const tools = [call('call-1'), call('call-2', { contentLength: 12 } as never)];

    expect(resolveExecutingToolCallIds(tools, true, running('call-2'))).toEqual(['call-1']);
  });

  it('treats an errored call as settled', () => {
    const tools = [call('call-1'), call('call-2', { error: new Error('boom') })];

    expect(resolveExecutingToolCallIds(tools, true, running('call-2'))).toEqual(['call-1']);
  });

  it('returns nothing when the message is no longer executing', () => {
    expect(resolveExecutingToolCallIds([call('call-1')], false, running('call-1'))).toEqual([]);
  });

  it('returns nothing when every call settled', () => {
    const tools = [call('call-1', { content: 'ok' }), call('call-2', { content: 'ok' })];

    expect(resolveExecutingToolCallIds(tools, true, new Set())).toEqual([]);
  });

  it('returns nothing for an empty or missing tool list', () => {
    expect(resolveExecutingToolCallIds([], true, new Set())).toEqual([]);
    expect(resolveExecutingToolCallIds(undefined, true, new Set())).toEqual([]);
  });
});
