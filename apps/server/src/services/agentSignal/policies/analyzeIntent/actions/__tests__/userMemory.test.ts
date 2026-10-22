// @vitest-environment node
import { LayersEnum } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RuntimeProcessorContext } from '../../../../runtime/context';
import {
  buildUserMemoryActionAgentSignalMarker,
  defineUserMemoryActionHandler,
  resolveMemoryActionTargetFromState,
  runMemoryActionAgent,
} from '../userMemory';

const envMock = vi.hoisted(() => ({ systemAgent: undefined as string | undefined }));

vi.mock('@/envs/app', () => ({
  get appEnv() {
    return { SYSTEM_AGENT: envMock.systemAgent };
  },
  getAppConfig: () => ({ SYSTEM_AGENT: envMock.systemAgent }),
}));

const memoryActionRunner = vi.fn();

const context = {
  now: () => 1,
  runtimeState: {
    getGuardState: vi.fn().mockResolvedValue({}),
    touchGuardState: vi.fn().mockResolvedValue({}),
  },
  scopeKey: 'topic:topic-1',
} as const satisfies RuntimeProcessorContext;

describe('defineUserMemoryActionHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs the memory action through the injected memory agent runner', async () => {
    memoryActionRunner.mockResolvedValue({
      status: 'applied',
    });

    const handler = defineUserMemoryActionHandler({
      db: {} as never,
      memoryActionRunner,
      userId: 'user_1',
    });

    const result = await handler.handle(
      {
        actionId: 'act_memory_agent',
        actionType: 'action.user-memory.handle',
        chain: { chainId: 'chain_1', rootSourceId: 'source_1' },
        payload: {
          agentId: 'agent_1',
          conflictPolicy: { forbiddenWith: ['none'], mode: 'fanout', priority: 100 },
          evidence: [{ cue: 'going forward', excerpt: 'Keep code review comments concise.' }],
          feedbackHint: 'not_satisfied',
          idempotencyKey: 'source_1:memory:msg_1',
          message: 'Going forward, keep code review comments concise and file-specific.',
          reason: 'durable future preference for code review',
          serializedContext: '{"surface":"chat"}',
          sourceHints: { intents: ['memory'] },
          topicId: 'topic_1',
        },
        signal: {
          signalId: 'sig_1',
          signalType: 'signal.feedback.domain.memory',
        },
        source: { sourceId: 'source_1', sourceType: 'agent.user.message' },
        timestamp: 1,
      },
      context,
    );

    expect(memoryActionRunner).toHaveBeenCalledWith({
      agentId: 'agent_1',
      conflictPolicy: { forbiddenWith: ['none'], mode: 'fanout', priority: 100 },
      evidence: [{ cue: 'going forward', excerpt: 'Keep code review comments concise.' }],
      feedbackHint: 'not_satisfied',
      message: 'Going forward, keep code review comments concise and file-specific.',
      reason: 'durable future preference for code review',
      serializedContext: '{"surface":"chat"}',
      sourceHints: { intents: ['memory'] },
      topicId: 'topic_1',
    });
    expect(result?.status).toBe('applied');
    expect(context.runtimeState.touchGuardState).toHaveBeenCalledTimes(1);
  });

  it('isolates the memory-agent thread on the user message id when no assistant boundary exists', async () => {
    // Non-clientRuntimeComplete source: sourceId has no `:completion:` segment,
    // so assistantMessageId is absent. The run must still create a child thread
    // under the triggering user message instead of leaking into the main topic.
    memoryActionRunner.mockResolvedValue({ status: 'applied' });

    const handler = defineUserMemoryActionHandler({
      db: {} as never,
      memoryActionRunner,
      userId: 'user_1',
    });

    await handler.handle(
      {
        actionId: 'act_memory_fallback_thread',
        actionType: 'action.user-memory.handle',
        chain: { chainId: 'chain_1', rootSourceId: 'source_1' },
        payload: {
          agentId: 'agent_1',
          idempotencyKey: 'source_1:memory:msg_user_1',
          message: 'Remember that I prefer concise answers.',
          messageId: 'msg_user_1',
          topicId: 'topic_1',
        },
        signal: { signalId: 'sig_1', signalType: 'signal.feedback.domain.memory' },
        source: { sourceId: 'source_1', sourceType: 'agent.user.message' },
        timestamp: 1,
      },
      context,
    );

    expect(memoryActionRunner).toHaveBeenCalledWith(
      expect.objectContaining({ sourceMessageId: 'msg_user_1', topicId: 'topic_1' }),
    );
  });

  it('returns the applied memory target from the memory agent runner', async () => {
    memoryActionRunner.mockResolvedValue({
      detail: 'Arvin Xu 希望助手在输出时每个段落/模块都写得更长、更展开。',
      status: 'applied',
      target: {
        id: 'mem_td3XirTeX4f7',
        memoryId: 'mem_8gISOK6BhxGP',
        memoryLayer: LayersEnum.Preference,
        summary: 'Arvin Xu 希望助手在输出时每个段落/模块都写得更长、更展开。',
        title: '偏好更详细、更长的回答段落',
        type: 'memory',
      },
    });

    const handler = defineUserMemoryActionHandler({
      db: {} as never,
      memoryActionRunner,
      userId: 'user_1',
    });

    const result = await handler.handle(
      {
        actionId: 'act_memory_target',
        actionType: 'action.user-memory.handle',
        chain: { chainId: 'chain_1', rootSourceId: 'source_1' },
        payload: {
          agentId: 'agent_1',
          idempotencyKey: 'source_1:memory:msg_1',
          message:
            '<speaker id="833816919" username="nivra2000" nickname="Aa T" />\n每一块都有点太短了？能否长一点呢',
          topicId: 'topic_1',
        },
        signal: {
          signalId: 'sig_1',
          signalType: 'signal.feedback.domain.memory',
        },
        source: { sourceId: 'source_1', sourceType: 'agent.user.message' },
        timestamp: 1,
      },
      context,
    );

    expect(result).toMatchObject({
      detail: 'Arvin Xu 希望助手在输出时每个段落/模块都写得更长、更展开。',
      output: {
        target: {
          id: 'mem_td3XirTeX4f7',
          memoryId: 'mem_8gISOK6BhxGP',
          memoryLayer: LayersEnum.Preference,
          summary: 'Arvin Xu 希望助手在输出时每个段落/模块都写得更长、更展开。',
          title: '偏好更详细、更长的回答段落',
          type: 'memory',
        },
      },
      status: 'applied',
    });
  });

  it('skips memory actions when the feedback message is missing', async () => {
    const handler = defineUserMemoryActionHandler({
      db: {} as never,
      memoryActionRunner,
      userId: 'user_1',
    });

    const result = await handler.handle(
      {
        actionId: 'act_missing_message',
        actionType: 'action.user-memory.handle',
        chain: { chainId: 'chain_1', rootSourceId: 'source_1' },
        payload: {
          idempotencyKey: 'source_1:memory:msg_missing',
          message: '   ',
        },
        signal: {
          signalId: 'sig_missing',
          signalType: 'signal.feedback.domain.memory',
        },
        source: { sourceId: 'source_1', sourceType: 'agent.user.message' },
        timestamp: 1,
      },
      context,
    );

    expect(memoryActionRunner).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      detail: 'Missing memory action message.',
      status: 'skipped',
    });
  });

  it('skips repeated actions after the same idempotency key was already applied', async () => {
    memoryActionRunner.mockResolvedValue({
      status: 'applied',
    });

    const getGuardState = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ lastEventAt: 1 });
    const touchGuardState = vi.fn().mockResolvedValue({});
    const idempotentContext = {
      ...context,
      runtimeState: { getGuardState, touchGuardState },
    } as const satisfies RuntimeProcessorContext;
    const handler = defineUserMemoryActionHandler({
      db: {} as never,
      memoryActionRunner,
      userId: 'user_1',
    });

    const action = {
      actionId: 'act_idempotent',
      actionType: 'action.user-memory.handle',
      chain: { chainId: 'chain_1', rootSourceId: 'source_1' },
      payload: {
        agentId: 'agent_1',
        idempotencyKey: 'source_1:memory:msg_repeat',
        message: 'Remember that I prefer conclusion-first answers.',
      },
      signal: {
        signalId: 'sig_repeat',
        signalType: 'signal.feedback.domain.memory',
      },
      source: { sourceId: 'source_1', sourceType: 'agent.user.message' },
      timestamp: 1,
    } as const;

    const first = await handler.handle(action, idempotentContext);
    const second = await handler.handle(action, idempotentContext);

    expect(first?.status).toBe('applied');
    expect(second).toMatchObject({
      detail: 'Action idempotency key already applied.',
      status: 'skipped',
    });
    expect(memoryActionRunner).toHaveBeenCalledTimes(1);
  });

  it('surfaces memory agent failures without marking idempotency', async () => {
    memoryActionRunner.mockResolvedValue({
      detail: 'Memory action agent finished with an error.',
      status: 'failed',
    });

    const handler = defineUserMemoryActionHandler({
      db: {} as never,
      memoryActionRunner,
      userId: 'user_1',
    });

    const result = await handler.handle(
      {
        actionId: 'act_failed',
        actionType: 'action.user-memory.handle',
        chain: { chainId: 'chain_1', rootSourceId: 'source_1' },
        payload: {
          agentId: 'agent_1',
          idempotencyKey: 'source_1:memory:msg_failed',
          message: 'Remember the style I liked yesterday.',
        },
        signal: {
          signalId: 'sig_failed',
          signalType: 'signal.feedback.domain.memory',
        },
        source: { sourceId: 'source_1', sourceType: 'agent.user.message' },
        timestamp: 1,
      },
      context,
    );

    expect(result).toMatchObject({
      detail: 'Memory action agent finished with an error.',
      status: 'failed',
    });
    expect(context.runtimeState.touchGuardState).not.toHaveBeenCalled();
  });

  it('does not poison the idempotency lane when the first agent attempt fails', async () => {
    memoryActionRunner
      .mockResolvedValueOnce({
        detail: 'Memory action agent finished with an error.',
        status: 'failed',
      })
      .mockResolvedValueOnce({
        status: 'applied',
      });

    const getGuardState = vi.fn().mockResolvedValue({});
    const touchGuardState = vi.fn().mockResolvedValue({});
    const retryableContext = {
      ...context,
      runtimeState: { getGuardState, touchGuardState },
    } as const satisfies RuntimeProcessorContext;
    const handler = defineUserMemoryActionHandler({
      db: {} as never,
      memoryActionRunner,
      userId: 'user_1',
    });

    const action = {
      actionId: 'act_retryable',
      actionType: 'action.user-memory.handle',
      chain: { chainId: 'chain_1', rootSourceId: 'source_1' },
      payload: {
        agentId: 'agent_1',
        idempotencyKey: 'source_1:memory:msg_retry',
        message: 'Going forward, remember that I want concise answers.',
      },
      signal: {
        signalId: 'sig_retry',
        signalType: 'signal.feedback.domain.memory',
      },
      source: { sourceId: 'source_1', sourceType: 'agent.user.message' },
      timestamp: 1,
    } as const;

    const first = await handler.handle(action, retryableContext);
    const second = await handler.handle(action, retryableContext);

    expect(first?.status).toBe('failed');
    expect(second?.status).toBe('applied');
    expect(touchGuardState).toHaveBeenCalledTimes(1);
    expect(memoryActionRunner).toHaveBeenCalledTimes(2);
  });
});

describe('runMemoryActionAgent memory switch', () => {
  const PLUGIN_QUERY_REACHED = new Error('plugin query reached');

  const createOptions = (input: { agentMemoryEnabled?: boolean; userMemoryEnabled?: boolean }) => {
    const pluginModel = { query: vi.fn().mockRejectedValue(PLUGIN_QUERY_REACHED) };
    const userModel = {
      getUserSettings: vi
        .fn()
        .mockResolvedValue(
          input.userMemoryEnabled === undefined
            ? undefined
            : { memory: { enabled: input.userMemoryEnabled } },
        ),
    };

    return {
      options: {
        agentService: {
          getAgentConfig: vi.fn().mockResolvedValue({
            chatConfig:
              input.agentMemoryEnabled === undefined
                ? {}
                : { memory: { enabled: input.agentMemoryEnabled } },
            model: 'gpt-test',
            provider: 'openai',
          }),
        },
        db: {} as never,
        pluginModel,
        userId: 'user-1',
        userModel,
      } as never,
      pluginModel,
      userModel,
    };
  };

  it('skips the memory writer when the user turned memory off', async () => {
    const { options, pluginModel } = createOptions({ userMemoryEnabled: false });

    await expect(
      runMemoryActionAgent({ agentId: 'agent-1', message: 'remember this' }, options),
    ).resolves.toEqual({
      detail: 'Memory is disabled for this agent or user.',
      status: 'skipped',
    });
    expect(pluginModel.query).not.toHaveBeenCalled();
  });

  it('skips the memory writer when the agent turned memory off', async () => {
    const { options, pluginModel, userModel } = createOptions({
      agentMemoryEnabled: false,
      userMemoryEnabled: true,
    });

    await expect(
      runMemoryActionAgent({ agentId: 'agent-1', message: 'remember this' }, options),
    ).resolves.toMatchObject({ status: 'skipped' });
    expect(userModel.getUserSettings).not.toHaveBeenCalled();
    expect(pluginModel.query).not.toHaveBeenCalled();
  });

  it('lets the agent-level switch override a disabled user setting', async () => {
    const { options } = createOptions({ agentMemoryEnabled: true, userMemoryEnabled: false });

    await expect(
      runMemoryActionAgent({ agentId: 'agent-1', message: 'remember this' }, options),
    ).rejects.toBe(PLUGIN_QUERY_REACHED);
  });

  it('keeps writing when memory has never been configured', async () => {
    const { options } = createOptions({});

    await expect(
      runMemoryActionAgent({ agentId: 'agent-1', message: 'remember this' }, options),
    ).rejects.toBe(PLUGIN_QUERY_REACHED);
  });
});

describe('runMemoryActionAgent memory analysis model', () => {
  // Reaching the plugin query means the run got past model resolution, which is
  // all these cases need: the runtime is not under test here.
  const RUNTIME_REACHED = new Error('plugin query reached');
  const AGENT_MODEL = 'agent-chat-model';

  const createHarness = (input: {
    agentMemoryEnabled?: boolean;
    memoryAnalysis?: { model?: string; provider?: string };
    options?: { model?: string; provider?: string };
    supportsTools?: boolean;
  }) => {
    const toolsEngineConfig = vi.fn();
    const pluginModel = { query: vi.fn().mockRejectedValue(RUNTIME_REACHED) };
    const userModel = {
      getUserSettings: vi.fn().mockResolvedValue({
        memory: { enabled: true },
        systemAgent: input.memoryAnalysis
          ? { memoryAnalysisAgentConfig: input.memoryAnalysis }
          : undefined,
      }),
    };

    const options = {
      agentService: {
        getAgentConfig: vi.fn().mockResolvedValue({
          chatConfig:
            input.agentMemoryEnabled === undefined
              ? {}
              : { memory: { enabled: input.agentMemoryEnabled } },
          model: AGENT_MODEL,
          provider: 'agent-provider',
        }),
      },
      db: {} as never,
      pluginModel,
      userId: 'user-1',
      userModel,
      ...input.options,
    } as never;

    return { options, pluginModel, toolsEngineConfig, userModel };
  };

  it('uses the Memory Analysis model the user assigned', async () => {
    const { options, userModel } = createHarness({
      memoryAnalysis: { model: 'mini-model', provider: 'mini-provider' },
    });

    await expect(
      runMemoryActionAgent({ agentId: 'agent-1', message: 'remember this' }, options),
    ).rejects.toBe(RUNTIME_REACHED);
    expect(userModel.getUserSettings).toHaveBeenCalled();
  });

  it('falls back to the agent model when the setting is absent', async () => {
    const { options } = createHarness({});

    await expect(
      runMemoryActionAgent({ agentId: 'agent-1', message: 'remember this' }, options),
    ).rejects.toBe(RUNTIME_REACHED);
  });

  it('keeps the agent model when the assigned model cannot call tools', async () => {
    // The writer needs the memory tool; a text-only model would silently write nothing.
    const { options } = createHarness({
      memoryAnalysis: { model: 'text-only-model', provider: 'text-only-provider' },
      supportsTools: false,
    });

    await expect(
      runMemoryActionAgent({ agentId: 'agent-1', message: 'remember this' }, options),
    ).rejects.toBe(RUNTIME_REACHED);
  });

  it('lets an explicit option override the user setting', async () => {
    const { options } = createHarness({
      memoryAnalysis: { model: 'mini-model', provider: 'mini-provider' },
      options: { model: 'explicit-model', provider: 'explicit-provider' },
    });

    await expect(
      runMemoryActionAgent({ agentId: 'agent-1', message: 'remember this' }, options),
    ).rejects.toBe(RUNTIME_REACHED);
  });
});

describe('runMemoryActionAgent memory analysis model resolution', () => {
  // The runtime call is stubbed to a terminal memory-writer state: what these
  // cases pin is which model+provider reached it, not how it behaved.
  const createHarness = (input: {
    agentModel?: string;
    agentProvider?: string;
    memoryAnalysis?: { model?: string; provider?: string };
    options?: { model?: string; provider?: string };
    supportsPreferred?: boolean;
    systemAgentEnv?: string;
  }) => {
    const agentModel = input.agentModel ?? 'agent-chat-model';
    const agentProvider = input.agentProvider ?? 'agent-provider';
    const createOperation = vi.fn().mockResolvedValue(undefined);
    const executeSync = vi.fn().mockResolvedValue({
      messages: [
        {
          id: 'msg_write',
          role: 'assistant',
          tool_calls: [
            {
              function: {
                arguments: JSON.stringify({ summary: 'Remembered.', title: 'A durable fact' }),
                name: 'lobe-user-memory____addPreferenceMemory',
              },
              id: 'call_write',
              type: 'function',
            },
          ],
        },
        {
          content:
            'Preference memory "A durable fact" saved with memoryId: "mem_1" and preferenceId: "mem_pref_1"',
          role: 'tool',
          tool_call_id: 'call_write',
        },
      ],
    });
    const toolsEngineConfigs: any[] = [];
    envMock.systemAgent = input.systemAgentEnv;

    vi.doMock('@/server/modules/Mecha', async (importOriginal) => {
      const actual = await importOriginal<Record<string, any>>();
      const original = actual.createServerAgentToolsEngine as any;
      return {
        ...actual,
        createServerAgentToolsEngine: (context: unknown, config: any) => {
          toolsEngineConfigs.push(config);
          const engine = original(context, config);
          return {
            ...engine,
            generateToolsDetailed: () => ({
              enabledToolIds: ['lobe-user-memory'],
              tools: [{ function: { name: 'lobe-user-memory____addPreferenceMemory' } }],
            }),
            getEnabledPluginManifests: () => new Map([['lobe-user-memory', { api: [] }]]),
          };
        },
      };
    });
    console.log('DEBUG env input =', input.systemAgentEnv);
    vi.doMock('@/business/client/model-bank/loadModels', () => ({
      loadModels: async () => [
        {
          abilities: { functionCall: input.supportsPreferred ?? true },
          id: 'preferred-model',
          providerId: 'preferred-provider',
        },
        {
          abilities: { functionCall: input.supportsExplicit ?? true },
          id: 'explicit-model',
          providerId: 'explicit-provider',
        },
        {
          abilities: { functionCall: input.supportsPreferred ?? true },
          id: 'env-model',
          providerId: 'env-provider',
        },
      ],
    }));
    vi.doMock('@/server/services/agentRuntime/AgentRuntimeService', () => ({
      AgentRuntimeService: class {
        createOperation = createOperation;
        executeSync = executeSync;
      },
    }));

    const userModel = {
      getUserSettings: vi.fn().mockResolvedValue({
        memory: { enabled: true },
        systemAgent: input.memoryAnalysis
          ? { memoryAnalysisAgentConfig: input.memoryAnalysis }
          : undefined,
      }),
    };

    const options = {
      agentService: {
        getAgentConfig: vi.fn().mockResolvedValue({
          chatConfig: {},
          model: agentModel,
          provider: agentProvider,
        }),
      },
      db: {} as never,
      pluginModel: { query: vi.fn().mockResolvedValue([]) },
      userId: 'user-1',
      userModel,
      ...input.options,
    } as never;

    return { agentModel, agentProvider, createOperation, options, toolsEngineConfigs };
  };

  const buildMessage = {
    agentId: 'agent-1',
    message: 'remember this',
    memoryLanguage: 'English',
  };

  afterEach(() => {
    vi.doUnmock('@/envs/app');
    vi.doUnmock('@/server/modules/Mecha');
    vi.doUnmock('@/business/client/model-bank/loadModels');
    vi.doUnmock('@/server/services/agentRuntime/AgentRuntimeService');
    vi.resetModules();
  });

  it('runs the writer on the Memory Analysis model the user assigned', async () => {
    const { createOperation, options } = createHarness({
      memoryAnalysis: { model: 'preferred-model', provider: 'preferred-provider' },
    });

    await runMemoryActionAgent(buildMessage, options);

    expect(createOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        agentConfig: expect.objectContaining({
          model: 'preferred-model',
          provider: 'preferred-provider',
        }),
        modelRuntimeConfig: { model: 'preferred-model', provider: 'preferred-provider' },
      }),
    );
  });

  it('falls back to the SYSTEM_AGENT env when the user never picked a model', async () => {
    const { createOperation, options } = createHarness({
      systemAgentEnv: 'memoryAnalysisAgentConfig=env-provider/env-model',
    });

    await runMemoryActionAgent(buildMessage, options);

    expect(createOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        modelRuntimeConfig: { model: 'env-model', provider: 'env-provider' },
      }),
    );
  });

  it('does not let the SYSTEM_AGENT default= entry reach the memory writer', async () => {
    // `default=` names a chat model; the parser skips the memory slots on purpose.
    const { agentModel, agentProvider, createOperation, options } = createHarness({
      systemAgentEnv: 'default=env-provider/env-model',
    });

    await runMemoryActionAgent(buildMessage, options);

    expect(createOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        modelRuntimeConfig: { model: agentModel, provider: agentProvider },
      }),
    );
  });

  it('prefers the user assignment over the SYSTEM_AGENT env', async () => {
    const { createOperation, options } = createHarness({
      memoryAnalysis: { model: 'preferred-model', provider: 'preferred-provider' },
      systemAgentEnv: 'memoryAnalysisAgentConfig=env-provider/env-model',
    });

    await runMemoryActionAgent(buildMessage, options);

    expect(createOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        modelRuntimeConfig: { model: 'preferred-model', provider: 'preferred-provider' },
      }),
    );
  });

  it('keeps the agent model and provider when the setting is absent', async () => {
    const { agentModel, agentProvider, createOperation, options } = createHarness({});

    await runMemoryActionAgent(buildMessage, options);

    expect(createOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        modelRuntimeConfig: { model: agentModel, provider: agentProvider },
      }),
    );
  });

  it('falls back to the agent model when the assigned one cannot call tools', async () => {
    // Writing needs the memory tool; a text-only model would silently write nothing.
    const { agentModel, agentProvider, createOperation, options } = createHarness({
      memoryAnalysis: { model: 'preferred-model', provider: 'preferred-provider' },
      supportsPreferred: false,
    });

    await runMemoryActionAgent(buildMessage, options);

    expect(createOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        modelRuntimeConfig: { model: agentModel, provider: agentProvider },
      }),
    );
  });

  it('lets an explicit option pair outrank the user setting', async () => {
    const { createOperation, options } = createHarness({
      memoryAnalysis: { model: 'preferred-model', provider: 'preferred-provider' },
      options: { model: 'explicit-model', provider: 'explicit-provider' },
    });

    await runMemoryActionAgent(buildMessage, options);

    // The settings read happens after the tool engine is built, so assert the
    // runtime config that actually carried the model.
    expect(createOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        modelRuntimeConfig: { model: 'explicit-model', provider: 'explicit-provider' },
      }),
    );
  });
});

describe('buildUserMemoryActionAgentSignalMarker', () => {
  it('keeps the user message as trigger without using it as the receipt anchor', () => {
    const marker = buildUserMemoryActionAgentSignalMarker({
      sourceId: 'source_1:memory:msg_user_1',
      topicId: 'topic_1',
      triggerMessageId: 'msg_user_1',
    });

    expect(marker).toEqual({
      kind: 'memory',
      sourceId: 'source_1:memory:msg_user_1',
      topicId: 'topic_1',
      triggerMessageId: 'msg_user_1',
    });
  });

  it('uses the assistant message as anchor while preserving the user trigger', () => {
    const marker = buildUserMemoryActionAgentSignalMarker({
      assistantMessageId: 'msg_assistant_1',
      sourceId: 'source_1:memory:msg_user_1',
      topicId: 'topic_1',
      triggerMessageId: 'msg_user_1',
    });

    expect(marker).toEqual({
      anchorMessageId: 'msg_assistant_1',
      kind: 'memory',
      sourceId: 'source_1:memory:msg_user_1',
      topicId: 'topic_1',
      triggerMessageId: 'msg_user_1',
    });
  });

  it('keeps an explicit trigger id separate from the feedback message id', () => {
    const marker = buildUserMemoryActionAgentSignalMarker({
      assistantMessageId: 'msg_assistant_1',
      sourceId: 'source_1:memory:msg_feedback_1',
      topicId: 'topic_1',
      triggerMessageId: 'msg_trigger_1',
    });

    expect(marker.triggerMessageId).toBe('msg_trigger_1');
  });
});

describe('resolveMemoryActionTargetFromState', () => {
  it('extracts the successful memory title from runtime tool calls', () => {
    const target = resolveMemoryActionTargetFromState({
      messages: [
        {
          id: 'msg_bad',
          role: 'assistant',
          tool_calls: [
            {
              function: {
                arguments: '{,',
                name: 'lobe-user-memory____addPreferenceMemory',
              },
              id: 'call_bad',
              type: 'function',
            },
          ],
        },
        {
          content: 'The tool call arguments string is not valid JSON.',
          role: 'tool',
          tool_call_id: 'call_bad',
        },
        {
          id: 'msg_good',
          role: 'assistant',
          tool_calls: [
            {
              function: {
                arguments: JSON.stringify({
                  details: '用户反馈当前回复的每个模块都太短，希望后续展开得更充分。',
                  summary: 'Arvin Xu 希望助手在输出时每个段落/模块都写得更长、更展开。',
                  title: '偏好更详细、更长的回答段落',
                  withPreference: {
                    conclusionDirectives: '回答时展开每个段落和模块。',
                  },
                }),
                name: 'lobe-user-memory____addPreferenceMemory',
              },
              id: 'call_good',
              type: 'function',
            },
          ],
        },
        {
          content:
            'Preference memory "偏好更详细、更长的回答段落" saved with memoryId: "mem_8gISOK6BhxGP" and preferenceId: "mem_td3XirTeX4f7"',
          role: 'tool',
          tool_call_id: 'call_good',
        },
      ],
    } as never);

    expect(target).toEqual({
      id: 'mem_td3XirTeX4f7',
      memoryId: 'mem_8gISOK6BhxGP',
      memoryLayer: LayersEnum.Preference,
      operation: 'create',
      summary: 'Arvin Xu 希望助手在输出时每个段落/模块都写得更长、更展开。',
      title: '偏好更详细、更长的回答段落',
      type: 'memory',
    });
  });

  it('resolves update identity targets from nested set arguments', () => {
    const target = resolveMemoryActionTargetFromState({
      messages: [
        {
          id: 'msg_update_identity',
          role: 'assistant',
          tool_calls: [
            {
              function: {
                arguments: JSON.stringify({
                  id: 'identity-existing',
                  mergeStrategy: 'replace',
                  set: {
                    details: 'The user clarified that they maintain LobeHub Agent Signal code.',
                    summary: 'The user maintains Agent Signal memory receipt behavior.',
                    title: 'Maintains Agent Signal receipts',
                  },
                }),
                name: 'lobe-user-memory____updateIdentityMemory',
              },
              id: 'call_update_identity',
              type: 'function',
            },
          ],
        },
        {
          content: 'Identity memory updated: identity-existing',
          pluginState: { identityId: 'identity-existing' },
          role: 'tool',
          tool_call_id: 'call_update_identity',
        },
      ],
    } as never);

    expect(target).toEqual({
      id: 'identity-existing',
      memoryLayer: LayersEnum.Identity,
      operation: 'update',
      summary: 'The user maintains Agent Signal memory receipt behavior.',
      title: 'Maintains Agent Signal receipts',
      type: 'memory',
    });
  });

  it('resolves receipt targets from persisted tool snapshots', () => {
    const target = resolveMemoryActionTargetFromState({
      messages: [
        {
          id: 'msg_persisted_tool',
          role: 'assistant',
          tools: [
            null,
            {
              apiName: 'addPreferenceMemory',
              arguments: {
                title: 'Persisted preference title',
                withPreference: {
                  conclusionDirectives: 'Use persisted tool metadata for receipt targets.',
                },
              },
              id: 'call_persisted',
              identifier: 'lobe-user-memory',
            },
          ],
        },
        {
          content: 'Preference memory saved',
          plugin: { id: 'call_persisted' },
          pluginState: { memoryId: 'mem_persisted', preferenceId: 'pref_persisted' },
          role: 'tool',
        },
      ],
    } as never);

    expect(target).toEqual({
      id: 'pref_persisted',
      memoryId: 'mem_persisted',
      memoryLayer: LayersEnum.Preference,
      operation: 'create',
      summary: 'Use persisted tool metadata for receipt targets.',
      title: 'Persisted preference title',
      type: 'memory',
    });
  });

  it('skips confirmed memory tool calls with invalid arguments', () => {
    const target = resolveMemoryActionTargetFromState({
      messages: [
        {
          id: 'msg_confirmed',
          role: 'assistant',
          tool_calls: [
            {
              function: {
                arguments: JSON.stringify({
                  details: 'Fallback details for a valid confirmed target.',
                  title: 'Valid confirmed preference',
                }),
                name: 'lobe-user-memory____addPreferenceMemory',
              },
              id: 'call_confirmed',
              type: 'function',
            },
          ],
        },
        {
          content:
            'Preference memory "Valid confirmed preference" saved with memoryId: "mem_confirmed" and preferenceId: "pref_confirmed"',
          role: 'tool',
          tool_call_id: 'call_confirmed',
        },
        {
          id: 'msg_invalid',
          role: 'assistant',
          tool_calls: [
            {
              function: {
                arguments: '{,',
                name: 'lobe-user-memory____addPreferenceMemory',
              },
              id: 'call_invalid',
              type: 'function',
            },
          ],
        },
        {
          content:
            'Preference memory "Invalid latest preference" saved with memoryId: "mem_invalid" and preferenceId: "pref_invalid"',
          role: 'tool',
          tool_call_id: 'call_invalid',
        },
      ],
    } as never);

    expect(target).toEqual({
      id: 'pref_confirmed',
      memoryId: 'mem_confirmed',
      memoryLayer: LayersEnum.Preference,
      operation: 'create',
      summary: 'Fallback details for a valid confirmed target.',
      title: 'Valid confirmed preference',
      type: 'memory',
    });
  });

  it('ignores unconfirmed memory write tool calls when resolving receipt targets', () => {
    const target = resolveMemoryActionTargetFromState({
      messages: [
        {
          id: 'msg_confirmed',
          role: 'assistant',
          tool_calls: [
            {
              function: {
                arguments: JSON.stringify({
                  summary: 'The user prefers longer, more developed answers.',
                  title: 'Confirmed preference title',
                }),
                name: 'lobe-user-memory____addPreferenceMemory',
              },
              id: 'call_confirmed',
              type: 'function',
            },
          ],
        },
        {
          content:
            'Preference memory "Confirmed preference title" saved with memoryId: "mem_confirmed" and preferenceId: "pref_confirmed"',
          role: 'tool',
          tool_call_id: 'call_confirmed',
        },
        {
          id: 'msg_unconfirmed',
          role: 'assistant',
          tool_calls: [
            {
              function: {
                arguments: JSON.stringify({
                  summary: 'This write was not confirmed by a successful tool result.',
                  title: 'Unconfirmed preference title',
                }),
                name: 'lobe-user-memory____addPreferenceMemory',
              },
              id: 'call_unconfirmed',
              type: 'function',
            },
          ],
        },
        {
          content: 'addPreferenceMemory with error detail: database timeout',
          role: 'tool',
          tool_call_id: 'call_unconfirmed',
        },
      ],
    } as never);

    expect(target).toEqual({
      id: 'pref_confirmed',
      memoryId: 'mem_confirmed',
      memoryLayer: LayersEnum.Preference,
      operation: 'create',
      summary: 'The user prefers longer, more developed answers.',
      title: 'Confirmed preference title',
      type: 'memory',
    });
  });

  it('does not resolve a target when no memory write has a successful tool result', () => {
    const target = resolveMemoryActionTargetFromState({
      messages: [
        {
          id: 'msg_unconfirmed',
          role: 'assistant',
          tool_calls: [
            {
              function: {
                arguments: JSON.stringify({
                  summary: 'This write was not confirmed by a successful tool result.',
                  title: 'Unconfirmed preference title',
                }),
                name: 'lobe-user-memory____addPreferenceMemory',
              },
              id: 'call_unconfirmed',
              type: 'function',
            },
          ],
        },
        {
          content: 'addPreferenceMemory with error detail: database timeout',
          role: 'tool',
          tool_call_id: 'call_unconfirmed',
        },
      ],
    } as never);

    expect(target).toBeUndefined();
  });
});
