import type * as ModelBankModule from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiAgentService } from '../index';

const { mockCreateOperation, mockFindTopic, mockGetAgentConfig, mockMessageCreate } = vi.hoisted(
  () => ({
    mockCreateOperation: vi.fn(),
    mockFindTopic: vi.fn(),
    mockGetAgentConfig: vi.fn(),
    mockMessageCreate: vi.fn(),
  }),
);

vi.mock('@/libs/trusted-client', () => ({
  generateTrustedClientToken: vi.fn().mockReturnValue(undefined),
  getTrustedClientTokenForSession: vi.fn().mockResolvedValue(undefined),
  isTrustedClientEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(() => ({
    create: mockMessageCreate,
    getLatestNonToolMessageId: vi.fn().mockResolvedValue(undefined),
    getLatestSpineMessageId: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue({}),
  })),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn().mockImplementation(() => ({
    getAgentConfig: vi.fn(),
    queryAgents: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/server/services/agent', () => ({
  AgentService: vi.fn().mockImplementation(() => ({
    getAgentConfig: mockGetAgentConfig,
  })),
}));

vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(() => ({
    create: vi.fn().mockResolvedValue({ id: 'topic-1' }),
    findById: mockFindTopic,
  })),
}));

vi.mock('@/database/models/thread', () => ({
  ThreadModel: vi.fn().mockImplementation(() => ({
    create: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
  })),
}));

vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(() => ({
    createOperation: mockCreateOperation,
  })),
}));

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn().mockImplementation(() => ({
    getLobehubSkillManifests: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/server/services/composio', () => ({
  ComposioService: vi.fn().mockImplementation(() => ({
    getComposioManifests: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({
    uploadFromUrl: vi.fn(),
  })),
}));

vi.mock('@/server/modules/Mecha', () => ({
  createServerAgentToolsEngine: vi.fn().mockReturnValue({
    generateToolsDetailed: vi.fn().mockReturnValue({ enabledToolIds: [], tools: [] }),
    getEnabledPluginManifests: vi.fn().mockReturnValue(new Map()),
  }),
  serverMessagesEngine: vi.fn().mockResolvedValue([{ content: 'test', role: 'user' }]),
}));

vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: {
    isConfigured: false,
    queryDeviceList: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('model-bank', async (importOriginal) => {
  const actual = await importOriginal<typeof ModelBankModule>();
  return {
    ...actual,
    LOBE_DEFAULT_MODEL_LIST: [
      {
        abilities: { functionCall: true, video: false, vision: true },
        id: 'gpt-4',
        providerId: 'openai',
      },
      {
        abilities: { functionCall: true, video: false, vision: true },
        id: 'claude-sonnet-4-6',
        providerId: 'anthropic',
      },
    ],
  };
});

describe('AiAgentService.execAgent - model/provider override', () => {
  let service: AiAgentService;
  const mockDb = {} as any;
  const userId = 'test-user-id';

  const defaultAgentConfig = {
    chatConfig: {},
    id: 'agent-1',
    model: 'gpt-4',
    plugins: [],
    provider: 'openai',
    slug: 'my-agent',
    systemRole: 'You are a helpful assistant.',
  };
  const mockTopicModelOverride = (agentId = 'agent-1') =>
    mockFindTopic.mockResolvedValue({
      agentId,
      id: 'topic-1',
      metadata: {
        modelOverride: { model: 'claude-sonnet-4-6', provider: 'anthropic' },
      },
    });
  const operationAgentConfig = () => mockCreateOperation.mock.calls[0][0].agentConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMessageCreate.mockResolvedValue({ id: 'msg-1' });
    mockCreateOperation.mockResolvedValue({
      autoStarted: true,
      messageId: 'queue-msg-1',
      operationId: 'op-123',
      success: true,
    });
    mockFindTopic.mockResolvedValue(undefined);
    service = new AiAgentService(mockDb, userId);
  });

  it('should use agent default model/provider when no override is provided', async () => {
    mockGetAgentConfig.mockResolvedValue({ ...defaultAgentConfig });

    await service.execAgent({
      agentId: 'agent-1',
      prompt: 'Hello',
    });

    expect(mockCreateOperation).toHaveBeenCalledTimes(1);
    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.agentConfig.model).toBe('gpt-4');
    expect(callArgs.agentConfig.provider).toBe('openai');
  });

  it('should override model when model param is provided', async () => {
    mockGetAgentConfig.mockResolvedValue({ ...defaultAgentConfig });

    await service.execAgent({
      agentId: 'agent-1',
      model: 'claude-sonnet-4-6',
      prompt: 'Hello',
    });

    expect(mockCreateOperation).toHaveBeenCalledTimes(1);
    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.agentConfig.model).toBe('claude-sonnet-4-6');
    expect(callArgs.agentConfig.provider).toBe('openai'); // provider unchanged
  });

  it('should override provider when provider param is provided', async () => {
    mockGetAgentConfig.mockResolvedValue({ ...defaultAgentConfig });

    await service.execAgent({
      agentId: 'agent-1',
      prompt: 'Hello',
      provider: 'anthropic',
    });

    expect(mockCreateOperation).toHaveBeenCalledTimes(1);
    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.agentConfig.model).toBe('gpt-4'); // model unchanged
    expect(callArgs.agentConfig.provider).toBe('anthropic');
  });

  it('should override both model and provider when both params are provided', async () => {
    mockGetAgentConfig.mockResolvedValue({ ...defaultAgentConfig });

    await service.execAgent({
      agentId: 'agent-1',
      model: 'claude-sonnet-4-6',
      prompt: 'Hello',
      provider: 'anthropic',
    });

    expect(mockCreateOperation).toHaveBeenCalledTimes(1);
    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.agentConfig.model).toBe('claude-sonnet-4-6');
    expect(callArgs.agentConfig.provider).toBe('anthropic');
  });

  it('uses the owning Topic model override for a normal run', async () => {
    mockGetAgentConfig.mockResolvedValue({ ...defaultAgentConfig });
    mockTopicModelOverride();

    await service.execAgent({
      agentId: 'agent-1',
      appContext: { topicId: 'topic-1' },
      prompt: 'Hello',
    });

    expect(operationAgentConfig()).toMatchObject({
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
    });
  });

  it('keeps explicit run parameters above the Topic override', async () => {
    mockGetAgentConfig.mockResolvedValue({ ...defaultAgentConfig });
    mockTopicModelOverride();

    await service.execAgent({
      agentId: 'agent-1',
      appContext: { topicId: 'topic-1' },
      model: 'gpt-4',
      prompt: 'Hello',
      provider: 'openai',
    });

    expect(operationAgentConfig()).toMatchObject({ model: 'gpt-4', provider: 'openai' });
  });

  it('does not apply the Group Topic override to a member run', async () => {
    mockGetAgentConfig.mockResolvedValue({ ...defaultAgentConfig, id: 'member-1' });
    mockTopicModelOverride('supervisor-1');

    await service.execAgent({
      agentId: 'member-1',
      appContext: { orchestrationRole: 'member', topicId: 'topic-1' },
      prompt: 'Hello',
    });

    expect(operationAgentConfig()).toMatchObject({ model: 'gpt-4', provider: 'openai' });
    expect(mockFindTopic).not.toHaveBeenCalled();
  });

  it('keeps Topic and inherited model overrides out of a heterogeneous Agent', async () => {
    mockGetAgentConfig.mockResolvedValue({
      ...defaultAgentConfig,
      model: 'claude-code',
      provider: 'claude-code',
    });
    mockTopicModelOverride();

    await expect(
      service.execAgent({
        agentId: 'agent-1',
        appContext: { topicId: 'topic-1' },
        model: 'parent-model',
        prompt: 'Hello',
        provider: 'parent-provider',
      }),
    ).rejects.toThrow('Failed to sign operation JWT for hetero agent');

    // The heterogeneous dispatch path performs its own later topic read. One
    // call proves the normal LLM override branch was skipped (otherwise two).
    expect(mockFindTopic).toHaveBeenCalledTimes(1);
  });
});
