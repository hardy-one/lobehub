import { describe, expect, it } from 'vitest';

import {
  createApprovedToolCall,
  getAddressableApprovalDecisions,
  refreshApprovedToolCall,
} from './approvalResume';

const plugin = {
  apiName: 'writeFile',
  arguments: '{"path":"a.txt"}',
  identifier: 'fs',
  type: 'default' as const,
};

describe('createApprovedToolCall', () => {
  it('merges the stored tool call id into a copy of the plugin payload', () => {
    const approved = createApprovedToolCall(plugin, 'call-current');

    expect(approved).toEqual({ ...plugin, id: 'call-current' });
    expect(approved).not.toBe(plugin);
    expect(plugin).not.toHaveProperty('id');
  });

  it('keeps the stored tool call id when refreshed plugin data is used', () => {
    const approved = createApprovedToolCall(plugin, 'call-current');
    const refreshed = { ...plugin, arguments: '{"path":"edited.txt"}', id: 'stale-id' };

    expect(refreshApprovedToolCall(approved, { plugin: refreshed })).toEqual({
      ...refreshed,
      id: 'call-current',
    });
  });

  it('keeps the approved tool call when refreshed plugin data is unavailable', () => {
    const approved = createApprovedToolCall(plugin, 'call-current');

    expect(refreshApprovedToolCall(approved, undefined)).toEqual(approved);
  });
});

describe('getAddressableApprovalDecisions', () => {
  it('keeps only stored, non-temporary tool rows with a call id', () => {
    const messages = new Map([
      ['tool-a', { tool_call_id: 'call-a' }],
      ['tmp_tool-b', { tool_call_id: 'call-b' }],
      ['tool-c', {}],
    ]);

    expect(
      getAddressableApprovalDecisions(['tool-a', 'tmp_tool-b', 'tool-c'], (id) => messages.get(id)),
    ).toEqual([{ decision: 'approved', parentMessageId: 'tool-a', toolCallId: 'call-a' }]);
  });
});
