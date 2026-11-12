import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { useTokenBreakdown } from './useTokenBreakdown';

const state = vi.hoisted(() => ({
  activeTopicId: undefined as string | undefined,
  activeGroupId: undefined as string | undefined,
  activeThreadId: undefined as string | undefined,
  /** `undefined`: the host publishes no topic; `null`: its conversation has none. */
  composerTopicId: undefined as string | null | undefined,
  composerInput: '',
  threadAgentId: undefined as string | undefined,
  summaries: {} as Record<string, string>,
  messages: [] as Array<{
    content: string;
    error?: unknown;
    id: string;
    role: string;
    usage?: Record<string, number>;
  }>,
}));

// One token per character, so a count names the text it was taken from.
vi.mock('@/hooks/useTokenCount', () => ({ useTokenCount: (text = '') => text.length }));
vi.mock('@/hooks/useModelContextWindowTokens', () => ({ useModelContextWindowTokens: () => 8000 }));
vi.mock('@/hooks/useModelSupportToolUse', () => ({ useModelSupportToolUse: () => false }));
vi.mock('@/helpers/toolEngineering', () => ({
  createAgentToolsEngine: () => ({
    generateToolsDetailed: () => ({ enabledManifests: [], tools: [] }),
  }),
}));

vi.mock('../../hooks/useAgentId', () => ({ useAgentId: () => 'agent-1' }));
// `useEffectiveModel` owns loading the composer topic by id (see `useTopicModel`);
// here the topic lands in `topicDetailMap` the way that fetch would put it.
vi.mock('../../hooks/useEffectiveModel', () => ({
  useEffectiveModel: () => ({ model: 'model-1', provider: 'provider-1' }),
}));

vi.mock('../../store', () => ({
  useChatInputStore: (selector: (s: object) => unknown) =>
    selector({ topicId: state.composerTopicId }),
  useStoreApi: () => ({
    getState: () => ({ contextWindowMessages: [], markdownContent: state.composerInput }),
    subscribe: () => () => {},
  }),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (s: object) => unknown) => selector({ activeAgentId: 'agent-1' }),
}));
vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgentKnowledgeBasesById: () => () => [],
    getAgentPluginsById: () => () => [],
    getAgentSystemRoleById: () => () => '',
  },
  chatConfigByIdSelectors: {
    getChatConfigById: () => () => ({}),
    getRuntimeModeById: () => () => undefined,
    getSkillActivateModeById: () => () => undefined,
  },
}));
vi.mock('@/store/aiInfra', () => ({
  useAiInfraStore: (selector: (s: object) => unknown) => selector({}),
}));
vi.mock('@/store/aiInfra/selectors', () => ({
  aiModelSelectors: {
    isModelBuiltinSearchInternal: () => () => false,
    isModelHasBuiltinSearch: () => () => false,
  },
  aiProviderSelectors: { isProviderHasBuiltinSearch: () => () => false },
}));
vi.mock('@/store/tool', () => ({
  useToolStore: (selector: (s: object) => unknown) => selector({ installedPlugins: [] }),
}));
vi.mock('@/store/user', () => ({
  useUserStore: (selector: (s: object) => unknown) => selector({}),
}));
vi.mock('@/store/user/selectors', () => ({ settingsSelectors: { memoryEnabled: () => false } }));

// Store boundary: the real topic selectors run against this state.
vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: object) => unknown) => {
    const topicId = state.composerTopicId ?? state.activeTopicId;
    const isActiveConversation = topicId === (state.activeTopicId ?? null);
    const isGroupConversation = isActiveConversation && Boolean(state.activeGroupId);
    const isGroupThread = isGroupConversation && Boolean(state.activeThreadId);
    const scope = isGroupConversation
      ? isGroupThread
        ? state.threadAgentId
          ? 'group_agent'
          : 'thread'
        : 'group'
      : undefined;
    const activeThread = state.activeThreadId
      ? [
          {
            id: state.activeThreadId,
            ...(state.threadAgentId ? { agentId: state.threadAgentId } : {}),
          },
        ]
      : [];
    const messagesKey = messageMapKey({
      agentId: 'agent-1',
      groupId: isActiveConversation ? state.activeGroupId : undefined,
      scope,
      subAgentId: state.threadAgentId,
      threadId: isActiveConversation ? state.activeThreadId : undefined,
      topicId,
    });
    const wrongGroupAgentKey = isGroupThread
      ? messageMapKey({
          agentId: 'agent-1',
          groupId: state.activeGroupId,
          scope: 'group_agent',
          topicId,
        })
      : undefined;

    return selector({
      activeTopicId: state.activeTopicId,
      activeGroupId: state.activeGroupId,
      activeThreadId: state.activeThreadId,
      dbMessagesMap: {
        [messagesKey]: state.messages,
        ...(wrongGroupAgentKey
          ? {
              [wrongGroupAgentKey]: [
                {
                  content: 'wrong bucket',
                  id: 'wrong',
                  role: 'assistant',
                  usage: { totalInputTokens: 999 },
                },
              ],
            }
          : {}),
      },
      threadMaps: topicId ? { [topicId]: activeThread } : {},
      topicDataMap: {},
      topicDetailMap: Object.fromEntries(
        Object.entries(state.summaries).map(([id, historySummary]) => [id, { historySummary, id }]),
      ),
    });
  },
}));

beforeEach(() => {
  // The main column's topic stays globally active while another composer renders its own.
  state.activeTopicId = 'main-topic';
  state.activeGroupId = undefined;
  state.activeThreadId = undefined;
  state.threadAgentId = undefined;
  state.composerTopicId = undefined;
  state.summaries = { 'main-topic': 'main column summary', 'pane-topic': 'pane' };
  state.composerInput = '';
  state.messages = [];
});

describe('useTokenBreakdown', () => {
  it('uses the group-agent bucket when the active group thread has a sub-agent identity', () => {
    state.activeGroupId = 'group-1';
    state.activeThreadId = 'thread-1';
    state.threadAgentId = 'agent-2';
    state.messages = [
      {
        content: 'group thread response',
        id: 'assistant-1',
        role: 'assistant',
        usage: { totalInputTokens: 321 },
      },
    ];

    const { result } = renderHook(() => useTokenBreakdown());

    expect(result.current.usedToken).toBe(321);
  });

  it('falls back to the thread bucket when a group thread has no sub-agent identity', () => {
    state.activeGroupId = 'group-1';
    state.activeThreadId = 'thread-1';
    state.messages = [
      {
        content: 'thread response',
        id: 'assistant-1',
        role: 'assistant',
        usage: { totalInputTokens: 123 },
      },
    ];

    const { result } = renderHook(() => useTokenBreakdown());

    expect(result.current.usedToken).toBe(123);
  });

  it('falls back to a local estimate when provider input is missing', () => {
    state.composerInput = 'draft';
    state.messages = [
      {
        content: 'failed response',
        id: 'assistant-1',
        role: 'assistant',
        usage: { totalOutputTokens: 20 },
      },
    ];

    const { result } = renderHook(() => useTokenBreakdown());

    expect(result.current.usedToken).toBe('draft'.length + 'main column summary'.length);
  });

  it('uses provider input plus cache read and write as the baseline', () => {
    state.messages = [
      {
        content: 'provider response',
        id: 'assistant-1',
        role: 'assistant',
        usage: {
          inputCacheMissTokens: 1_900,
          inputCachedTokens: 25_200,
          inputWriteCacheTokens: 0,
        },
      },
    ];

    const { result } = renderHook(() => useTokenBreakdown());

    expect(result.current.usedToken).toBe(27_100);
  });

  it('adds only local input after the provider baseline', () => {
    state.messages = [
      {
        content: 'provider response',
        id: 'assistant-1',
        role: 'assistant',
        usage: { totalInputTokens: 100 },
      },
      { content: 'new message', id: 'user-1', role: 'user' },
    ];

    const { result } = renderHook(() => useTokenBreakdown());

    expect(result.current.usedToken).toBe(100 + 'new message'.length);
  });

  it("counts the composer's own topic summary rather than the global active topic's", () => {
    state.composerTopicId = 'pane-topic';

    const { result } = renderHook(() => useTokenBreakdown());

    expect(result.current.historySummaryToken).toBe('pane'.length);
  });

  it('counts no summary when the composer conversation has no topic, even with an active topic', () => {
    state.composerTopicId = null;

    const { result } = renderHook(() => useTokenBreakdown());

    expect(result.current.historySummaryToken).toBe(0);
  });

  it('follows the global active topic when the host publishes no topic', () => {
    const { result } = renderHook(() => useTokenBreakdown());

    expect(result.current.historySummaryToken).toBe('main column summary'.length);
  });

  // A document's chat panel runs on a `trigger='document'` system topic that
  // never reaches the loaded lists, yet the run includes its persisted summary.
  it('counts an unlisted composer topic summary once its detail arrives', () => {
    state.composerTopicId = 'doc-topic';

    const { rerender, result } = renderHook(() => useTokenBreakdown());

    expect(result.current.historySummaryToken).toBe(0);

    state.summaries['doc-topic'] = 'doc summary';
    rerender();

    expect(result.current.historySummaryToken).toBe('doc summary'.length);
  });

  // `/goal/:goalId` makes a sidebar-excluded supervision topic globally active
  // with no `useFetchActiveTopicDetail` mounted.
  it('counts the global active topic summary once its detail arrives', () => {
    state.composerTopicId = 'main-topic';
    delete state.summaries['main-topic'];

    const { rerender, result } = renderHook(() => useTokenBreakdown());

    expect(result.current.historySummaryToken).toBe(0);

    state.summaries['main-topic'] = 'goal summary';
    rerender();

    expect(result.current.historySummaryToken).toBe('goal summary'.length);
  });
});
