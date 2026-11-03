import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import type { MessagesEngineParams } from '../../engine/messages/types';
import { hashContent } from '../canonical';
import { ON_DEMAND_PROTOCOL_CONTENT } from '../protocolBuilder';
import { processOnDemandMessages } from './OnDemandMessagesPipeline';

const AT = 1_700_000_000_000;

const message = (value: Partial<UIChatMessage>): UIChatMessage =>
  ({
    content: '',
    createdAt: AT,
    id: 'message',
    role: 'user',
    updatedAt: AT,
    ...value,
  }) as UIChatMessage;

const createParams = (overrides: Partial<MessagesEngineParams> = {}): MessagesEngineParams => ({
  contextMode: 'on-demand',
  messages: [message({ content: 'deploy rollback release', id: 'u1', role: 'user' })],
  model: 'gpt-4',
  provider: 'openai',
  systemRole: 'Agent prompt',
  ...overrides,
});

const runtimeContextParams = (): Partial<MessagesEngineParams> => ({
  agentBuilderContext: { meta: { title: 'Builder agent' } },
  agentIdentity: { name: 'Ada', title: 'Release engineer' },
  agentManagementContext: { currentAgent: { id: 'agent-1', title: 'Release engineer' } },
  botPlatformContext: { platformName: 'WeChat', supportsMarkdown: false },
  connectorOwnershipNote: 'Connector note',
  discordContext: {
    channel: { id: 'channel-1', name: 'release' },
    guild: { id: 'guild-1', name: 'Release guild' },
  },
  enableExpertise: true,
  evalContext: { envPrompt: 'Eval prompt' },
  expertise: {
    contentHash: 'expertise-hash',
    domains: [],
    renderedContext: 'deploy rollback release expertise',
    schemaVersion: 1,
  },
  forceFinish: true,
  groupAgentBuilderContext: { groupId: 'group-1', groupTitle: 'Release group' },
  historySummary: 'Prior summary',
  initialContext: {
    activeTopicDocument: {
      documentId: 'document-1',
      title: 'Release document',
    },
    goalOverview: {
      findings: ['Rollback already verified'],
      goal: {
        status: 'running',
        title: 'Ship the release',
      },
      pendingDecisions: [],
      tasks: [],
    },
    mentionedAgents: [{ id: 'agent-2', name: 'Reviewer' }],
    projectContext: { contextPrompt: 'Project context' },
    taskManager: { contextPrompt: 'Task context' },
  },
  onboardingContext: { phaseGuidance: 'Onboarding guidance' },
  planTodo: {
    enabled: true,
    plan: {
      completed: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      description: 'Release plan description',
      goal: 'Ship the release',
      id: 'plan-1',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  },
  projectInstructions: [{ content: 'Project deploy rule', source: 'AGENTS.md' }],
  stepContext: {
    todos: {
      items: [
        { status: 'processing', text: 'Ship release' },
        { status: 'todo', text: 'Verify rollback' },
      ],
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  },
  topicReferences: [{ summary: 'Topic summary', topicId: 'topic-1', topicTitle: 'Topic' }],
  workspaceContext: { appUrl: 'https://app.lobehub.com', workspace: { slug: 'team' } },
});

describe('OnDemandMessagesPipeline runtime context', () => {
  it('returns the stable system prompt and history when there is no current user message', async () => {
    const result = await processOnDemandMessages(
      createParams({
        forceFinish: true,
        messages: [message({ content: 'previous assistant answer', id: 'a1', role: 'assistant' })],
      }),
    );

    expect(result.messages).toEqual([
      { content: `Agent prompt\n\n${ON_DEMAND_PROTOCOL_CONTENT}`, role: 'system' },
      { content: 'previous assistant answer', role: 'assistant' },
    ]);
    expect(result.metadata.dynamicEntries).toEqual([]);
    expect(result.metadata.onDemandContext?.currentUserMessageHash).toBeUndefined();
    expect(result.metadata.onDemandContext?.retrieval).toBeUndefined();
    expect(result.metadata.onDemandContext?.budget.fixedBreakdown.currentUserMessage).toBe(0);
    expect(result.stats.processedCount).toBe(Object.keys(result.stats.processorDurations).length);
  });

  it('does not fail on a current user message without textual content', async () => {
    const content = [
      { image_url: { url: 'https://example.com/image.png' }, type: 'image_url' },
    ] as never;
    const result = await processOnDemandMessages(
      createParams({
        messages: [message({ content, id: 'u1', role: 'user' })],
      }),
    );

    expect(result.messages).toEqual([
      { content: `Agent prompt\n\n${ON_DEMAND_PROTOCOL_CONTENT}`, role: 'system' },
      { content, role: 'user' },
    ]);
    expect(result.metadata.dynamicEntries).toEqual([]);
    expect(result.metadata.onDemandContext?.currentUserMessageHash).toBeUndefined();
    expect(result.metadata.onDemandContext?.messageSegments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          index: 1,
          source: 'current_user',
        }),
      ]),
    );
  });

  it('preserves current user context selections in the dynamic suffix', async () => {
    const result = await processOnDemandMessages(
      createParams({
        messages: [
          message({
            content: 'Rewrite this selection',
            id: 'u1',
            metadata: {
              contextSelections: [
                {
                  content: 'Selected release note',
                  id: 'selection-1',
                  source: 'text',
                  title: 'Release note',
                },
              ],
            } as any,
            role: 'user',
          }),
        ],
      }),
    );

    expect(result.messages[1]).toEqual({
      content: 'Rewrite this selection',
      role: 'user',
    });
    expect(
      result.messages
        .slice(2)
        .map((entry) => entry.content)
        .join('\n'),
    ).toContain('Selected release note');
    expect(result.metadata.dynamicEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          included: true,
          key: 'message:u1:context-selections',
          required: false,
        }),
      ]),
    );
  });

  it('preserves context selections owned by historical user messages', async () => {
    const result = await processOnDemandMessages(
      createParams({
        messages: [
          message({
            content: 'Remember this earlier selection',
            id: 'u1',
            metadata: {
              contextSelections: [
                {
                  content: 'Historical selected release schema',
                  id: 'selection-history',
                  source: 'text',
                  title: 'Earlier release schema',
                },
              ],
            } as any,
            role: 'user',
          }),
          message({ content: 'Previous answer', id: 'a1', role: 'assistant' }),
          message({
            content: 'Use both selections',
            id: 'u2',
            metadata: {
              contextSelections: [
                {
                  content: 'Current selected release note',
                  id: 'selection-current',
                  source: 'text',
                  title: 'Current release note',
                },
              ],
            } as any,
            role: 'user',
          }),
        ],
      }),
    );
    const suffix = result.messages
      .slice(4)
      .map((entry) => String(entry.content))
      .join('\n');

    expect(suffix).toContain('Historical selected release schema');
    expect(suffix).toContain('Current selected release note');
    expect(result.metadata.dynamicEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          included: true,
          key: 'message:u1:context-selections',
          priority: 40,
          required: false,
        }),
        expect.objectContaining({
          included: true,
          key: 'message:u2:context-selections',
          priority: 995,
          required: false,
        }),
      ]),
    );
  });

  it('degrades a current selection that cannot fit the shared budget', async () => {
    const marker = 'PRIVATE_SELECTION_BODY';
    const result = await processOnDemandMessages(
      createParams({
        messages: [
          message({
            content: 'Summarize the selected page',
            id: 'u1',
            metadata: {
              contextSelections: [
                {
                  content: `${marker} ${'release notes '.repeat(4_000)}`,
                  id: 'selection-large',
                  source: 'page',
                  title: 'Large release page',
                },
              ],
            } as any,
            role: 'user',
          }),
        ],
        onDemand: { budget: { dynamicTokens: 600, reserveTokens: 0, totalTokens: 2_000 } },
      }),
    );
    const selection = result.metadata.dynamicEntries?.find(
      (entry) => entry.key === 'message:u1:context-selections',
    );
    const suffix = result.messages
      .slice(2)
      .map((entry) => String(entry.content))
      .join('\n');

    expect(selection).toMatchObject({
      decision: 'degraded',
      included: true,
      required: false,
    });
    expect(selection?.degradation).toMatchObject({
      reason: 'budget_exceeded',
    });
    expect(suffix).toContain('&lt;on_demand_summary');
    expect(suffix).not.toContain('release notes '.repeat(100));
    expect(result.metadata.onDemandContext?.budget.totalTokens).toBeLessThanOrEqual(2_000);
  });

  it('restores the skill import route for a linked skill source', async () => {
    const result = await processOnDemandMessages(
      createParams({
        messages: [
          message({
            content: 'Install https://lobehub.com/skills/release-helper',
            id: 'u1',
            role: 'user',
          }),
        ],
        toolsConfig: {
          manifests: [
            {
              api: [],
              identifier: 'lobe-skill-store',
              meta: {},
              systemRole: '',
            },
          ],
        },
      }),
    );
    const suffix = result.messages
      .slice(2)
      .map((entry) => entry.content)
      .join('\n');

    expect(suffix).toContain('<detected_skills>');
    expect(suffix).toContain('install="importFromMarket"');
    expect(suffix).toContain('identifier="release-helper"');
    expect(result.metadata.dynamicEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          included: true,
          key: 'message:u1:skill-import-route',
          required: true,
        }),
      ]),
    );
  });

  it('replays local system tool snapshots as native tool calls and results', async () => {
    const result = await processOnDemandMessages(
      createParams({
        messages: [
          message({
            content: 'Read the release file',
            id: 'u1',
            metadata: {
              localSystemToolSnapshots: [
                {
                  apiName: 'readLocalFile',
                  arguments: { path: '/tmp/release.md' },
                  content: '<file path="/tmp/release.md">ready</file>',
                  identifier: 'lobe-local-system',
                  snapshotId: 'snapshot-1',
                  success: true,
                  toolCallId: 'call_snapshot_1',
                },
              ],
            } as any,
            role: 'user',
          }),
          message({ content: 'Summarize the release', id: 'u2', role: 'user' }),
        ],
      }),
    );

    expect(result.messages[2]).toMatchObject({
      role: 'assistant',
      tool_calls: [
        {
          function: {
            arguments: '{"path":"/tmp/release.md"}',
            name: 'lobe-local-system.readLocalFile',
          },
          id: 'call_snapshot_1',
          type: 'function',
        },
      ],
    });
    expect(result.messages[3]).toMatchObject({
      content: '<file path="/tmp/release.md">ready</file>',
      role: 'tool',
      tool_call_id: 'call_snapshot_1',
    });
    expect(result.messages[4].content).toBe('Summarize the release');
  });

  it('uses the last multimodal user message instead of an earlier text turn', async () => {
    const content = [
      { text: 'deploy rollback release', type: 'text' },
      { image_url: { url: 'https://example.com/image.png' }, type: 'image_url' },
    ] as never;
    const result = await processOnDemandMessages(
      createParams({
        messages: [
          message({ content: 'summarize quarterly revenue', id: 'u1', role: 'user' }),
          message({ content: 'Previous answer', id: 'a1', role: 'assistant' }),
          message({ content, id: 'u2', role: 'user' }),
        ],
        onDemand: { budget: { dynamicTokens: 20_000, reserveTokens: 0, totalTokens: 20_000 } },
      }),
    );
    const includedKeys =
      result.metadata.dynamicEntries?.filter((entry) => entry.included).map((entry) => entry.key) ??
      [];

    expect(includedKeys).toContain('environment:system-date');
    expect(result.metadata.onDemandContext?.currentUserMessageHash).toBe(
      hashContent({ content: 'deploy rollback release', id: 'u2', role: 'user' }),
    );
    expect(result.metadata.onDemandContext?.messageSegments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          index: 3,
          source: 'current_user',
        }),
      ]),
    );
  });

  it('injects runtime context that legacy injectors used to provide', async () => {
    const result = await processOnDemandMessages(
      createParams({
        ...runtimeContextParams(),
        onDemand: { budget: { dynamicTokens: 50_000, reserveTokens: 0, totalTokens: 50_000 } },
      }),
    );
    const includedKeys =
      result.metadata.dynamicEntries?.filter((entry) => entry.included).map((entry) => entry.key) ??
      [];
    const suffix = result.messages
      .slice(2)
      .map((entry) => String(entry.content))
      .join('\n');

    expect(includedKeys).toEqual(
      expect.arrayContaining([
        'runtime:force-finish',
        'runtime:project-instructions',
        'runtime:plan:plan-1',
        'runtime:todos',
        'runtime:history-summary',
        'runtime:connector-ownership',
        'runtime:eval',
        'runtime:bot-platform',
        'runtime:workspace',
        'runtime:agent-identity',
        'runtime:agent-builder',
        'runtime:group-agent-builder',
        'runtime:agent-management',
        'runtime:agent-management:mentioned-agents',
        'runtime:discord',
        'runtime:onboarding',
        'runtime:topic-references',
        'runtime:active-topic-document',
        'runtime:goal-overview',
        'runtime:project',
        'runtime:task-manager',
        'runtime:expertise:expertise-hash',
      ]),
    );
    expect(suffix).toContain('maximum step limit');
    expect(suffix).toContain('Project deploy rule');
    expect(suffix).toContain('Ship the release');
    expect(suffix).toContain('Verify rollback');
    expect(suffix).toContain('Topic summary');
    expect(suffix).toContain('Onboarding guidance');
    expect(suffix).toContain('current document snapshot');
    expect(suffix).toContain('Rollback already verified');
    expect(suffix).toContain('Reviewer');
    expect(suffix).toContain('https://app.lobehub.com/team');
  });

  it('uses group context instead of the individual agent identity', async () => {
    const result = await processOnDemandMessages(
      createParams({
        agentGroup: {
          agentMap: {
            'agent-1': { name: 'Ada', role: 'participant' },
            'agent-2': { name: 'Reviewer', role: 'supervisor' },
          },
          currentAgentId: 'agent-1',
          currentAgentName: 'Ada',
          currentAgentRole: 'participant',
          groupTitle: 'Release group',
          members: [
            { id: 'agent-1', name: 'Ada', role: 'participant' },
            { id: 'agent-2', name: 'Reviewer', role: 'supervisor' },
          ],
          systemPrompt: 'Review every release.',
        },
        agentIdentity: { name: 'Ignored identity' },
        onDemand: { budget: { dynamicTokens: 20_000, reserveTokens: 0, totalTokens: 20_000 } },
      }),
    );
    const includedKeys =
      result.metadata.dynamicEntries?.filter((entry) => entry.included).map((entry) => entry.key) ??
      [];
    const suffix = result.messages
      .slice(2)
      .map((entry) => String(entry.content))
      .join('\n');

    expect(includedKeys).toContain('runtime:agent-group');
    expect(includedKeys).not.toContain('runtime:agent-identity');
    expect(suffix).toContain('Release group');
    expect(suffix).toContain('Reviewer');
    expect(suffix).not.toContain('Ignored identity');
  });
});
