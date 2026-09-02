import { describe, expect, it } from 'vitest';

import type { AgentRow } from '@/features/Home/AgentSelect/useHomeAgentRows';
import type { LobeAgentSession, LobeSessions } from '@/types/session';

import { getMobileAgentOnlyRows } from './getMobileAgentOnlyRows';

const createSession = (agentId: string): LobeAgentSession =>
  ({
    config: { id: agentId },
    id: `session-${agentId}`,
    meta: {},
    type: 'agent',
  }) as unknown as LobeAgentSession;

describe('getMobileAgentOnlyRows', () => {
  it('keeps a heterogeneous agent visible before it has a session', () => {
    const updatedAt = new Date('2025-01-01');
    const rows: AgentRow[] = [
      {
        heterogeneousType: 'codex',
        id: 'agent-codex',
        title: 'Codex',
        updatedAt,
      },
    ];

    expect(getMobileAgentOnlyRows(rows, [], 'agent-inbox')).toEqual([
      {
        avatar: undefined,
        backgroundColor: undefined,
        heterogeneousType: 'codex',
        id: 'agent-codex',
        pinned: false,
        title: 'Codex',
        type: 'agent',
        updatedAt,
      },
    ]);
  });

  it('does not duplicate session-backed agents or the inbox agent', () => {
    const rows: AgentRow[] = [
      { id: 'agent-backed', title: 'Backed' },
      { id: 'agent-inbox', title: 'Inbox' },
      { id: 'agent-new', title: 'New' },
    ];
    const sessions: LobeSessions = [createSession('agent-backed')];

    expect(getMobileAgentOnlyRows(rows, sessions, 'agent-inbox').map(({ id }) => id)).toEqual([
      'agent-new',
    ]);
  });
});
