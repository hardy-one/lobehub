import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerAgentCommand } from './agent';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    aiAgent: {
      execAgent: { mutate: vi.fn() },
    },
    user: {
      getUserState: { query: vi.fn() },
    },
  },
}));

const { mockGetTrpcClient } = vi.hoisted(() => ({
  mockGetTrpcClient: vi.fn(),
}));

const { mockFollowAgentRun } = vi.hoisted(() => ({
  mockFollowAgentRun: vi.fn(),
}));

vi.mock('../api/client', () => ({ getTrpcClient: mockGetTrpcClient }));
vi.mock('./agent/followRun', () => ({ followAgentRun: mockFollowAgentRun }));

const createProgram = () => {
  const program = new Command();
  program.exitOverride();
  registerAgentCommand(program);
  return program;
};

describe('agent run on-demand context options', () => {
  beforeEach(() => {
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    mockFollowAgentRun.mockResolvedValue({ kind: 'completed', status: 'done' });
    mockTrpcClient.aiAgent.execAgent.mutate.mockReset();
    mockTrpcClient.user.getUserState.query.mockReset();
    mockTrpcClient.user.getUserState.query.mockResolvedValue(undefined);
  });

  it('should explicitly request manual approval with --no-headless', async () => {
    mockTrpcClient.aiAgent.execAgent.mutate.mockResolvedValue({
      operationId: 'op-manual',
      success: true,
    });

    await createProgram().parseAsync([
      'node',
      'test',
      'agent',
      'run',
      '--agent-id',
      'a1',
      '--prompt',
      'Wait for approval',
      '--no-headless',
    ]);

    expect(mockTrpcClient.aiAgent.execAgent.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        userInterventionConfig: { approvalMode: 'manual' },
      }),
    );
  });

  it('should pass repeated --skill options as selectedSkillIds', async () => {
    mockTrpcClient.aiAgent.execAgent.mutate.mockResolvedValue({
      operationId: 'op-skills',
      success: true,
    });

    await createProgram().parseAsync([
      'node',
      'test',
      'agent',
      'run',
      '--agent-id',
      'a1',
      '--prompt',
      'Use selected skills',
      '--skill',
      'lobehub',
      '--skill',
      'acceptance',
    ]);

    expect(mockTrpcClient.aiAgent.execAgent.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ selectedSkillIds: ['lobehub', 'acceptance'] }),
    );
  });
});
