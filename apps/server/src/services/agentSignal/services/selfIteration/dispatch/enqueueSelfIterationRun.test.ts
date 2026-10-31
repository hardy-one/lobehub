// @vitest-environment node
import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { DEFAULT_SYSTEM_AGENT_CONFIG } from '@lobechat/const';
import type { LobeChatDatabase } from '@lobechat/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  enqueueSelfIterationRun,
  type EnqueueSelfIterationRunInput,
} from './enqueueSelfIterationRun';

const { execAgent, createThread } = vi.hoisted(() => ({
  createThread: vi.fn(),
  execAgent: vi.fn(),
}));

vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: class {
    execAgent = execAgent;
  },
}));

vi.mock('@/database/models/thread', () => ({
  ThreadModel: class {
    create = createThread;
  },
}));

const findSettings = vi.fn();
const db = {
  query: { userSettings: { findFirst: findSettings } },
} as unknown as LobeChatDatabase;

const input = {
  agentId: 'reviewed-agent',
  db,
  marker: {
    agentId: 'reviewed-agent',
    kind: 'nightly-review',
    sourceId: 'nightly-review:user-1:reviewed-agent:2026-10-31',
  },
  prompt: 'Review the supplied evidence.',
  slug: BUILTIN_AGENT_SLUGS.nightlyReview,
  userId: 'user-1',
} satisfies EnqueueSelfIterationRunInput;

describe('enqueueSelfIterationRun model selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findSettings.mockResolvedValue({
      systemAgent: { expertise: { model: 'gpt-5.6-luna', provider: 'cpa' } },
    });
    execAgent.mockResolvedValue({ operationId: 'operation-1', topicId: 'topic-1' });
    createThread.mockResolvedValue({ id: 'thread-1' });
  });

  it.each([
    BUILTIN_AGENT_SLUGS.nightlyReview,
    BUILTIN_AGENT_SLUGS.selfReflection,
    BUILTIN_AGENT_SLUGS.selfFeedbackIntent,
    BUILTIN_AGENT_SLUGS.skillManagement,
  ])('dispatches %s with the configured self-evolution model and provider', async (slug) => {
    await enqueueSelfIterationRun({ ...input, slug });

    expect(execAgent).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-5.6-luna', provider: 'cpa', slug }),
    );
  });

  it('reads the current self-evolution model for every new run', async () => {
    await enqueueSelfIterationRun(input);
    findSettings.mockResolvedValue({
      systemAgent: { expertise: { model: 'another-model', provider: 'another-provider' } },
    });
    await enqueueSelfIterationRun(input);

    expect(execAgent.mock.calls.map(([params]) => [params.provider, params.model])).toEqual([
      ['cpa', 'gpt-5.6-luna'],
      ['another-provider', 'another-model'],
    ]);
  });

  it('uses the system self-evolution defaults when no user settings exist', async () => {
    findSettings.mockResolvedValue(undefined);

    await enqueueSelfIterationRun(input);

    expect(execAgent).toHaveBeenCalledWith(
      expect.objectContaining(DEFAULT_SYSTEM_AGENT_CONFIG.expertise),
    );
  });

  it('preserves the reviewed agent attribution and isolation thread', async () => {
    const result = await enqueueSelfIterationRun({
      ...input,
      sourceMessageId: 'message-1',
      topicId: 'existing-topic',
      workspaceId: 'workspace-1',
    });

    expect(execAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        appContext: expect.objectContaining({
          agentSignal: input.marker,
          sourceMessageId: 'message-1',
          suppressSignal: true,
          threadId: 'thread-1',
          topicId: 'existing-topic',
        }),
        model: 'gpt-5.6-luna',
        provider: 'cpa',
      }),
    );
    expect(result).toEqual({
      operationId: 'operation-1',
      threadId: 'thread-1',
      topicId: 'topic-1',
    });
  });

  it('does not create a thread or dispatch a run when settings cannot be read', async () => {
    findSettings.mockRejectedValue(new Error('Settings unavailable'));

    await expect(
      enqueueSelfIterationRun({
        ...input,
        sourceMessageId: 'message-1',
        topicId: 'existing-topic',
      }),
    ).rejects.toThrow('Settings unavailable');

    expect(createThread).not.toHaveBeenCalled();
    expect(execAgent).not.toHaveBeenCalled();
  });
});
