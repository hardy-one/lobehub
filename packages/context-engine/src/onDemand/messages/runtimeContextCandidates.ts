import {
  agentIdentityPrompt,
  buildGoalOverviewPrompt,
  escapeXmlAttr,
  escapeXmlContent,
  formatBotPlatformContext,
  formatDiscordContext,
  formatGroupMembers,
  groupContextTemplate,
  workspaceContextPrompt,
} from '@lobechat/prompts';

import type { MessagesEngineParams } from '../../engine/messages/types';
import { formatActiveTopicDocumentContext } from '../../providers/ActiveTopicDocumentContextInjector';
import { formatAgentContext } from '../../providers/AgentBuilderContextInjector';
import {
  type AgentManagementContext,
  formatAgentManagementContext,
  formatMentionedAgentsContext,
} from '../../providers/AgentManagementContextInjector';
import { FORCE_FINISH_SUMMARY_CONTENT } from '../../providers/ForceFinishSummaryInjector';
import { formatGroupAgentBuilderContext } from '../../providers/GroupAgentBuilderContextInjector';
import { formatHistorySummary } from '../../providers/HistorySummary';
import { formatOnboardingContext } from '../../providers/OnboardingContextInjector';
import { formatPlan } from '../../providers/PlanInjector';
import { formatTodos } from '../../providers/TodoInjector';
import { formatTopicReferences } from '../../providers/TopicReferenceContextInjector';
import { scoreLexicalRelevance } from '../retrieval/ranking';
import { createOnDemandDynamicCandidate, type OnDemandDynamicCandidate } from './dynamicCandidates';

const renderProjectInstructions = (
  instructions: NonNullable<MessagesEngineParams['projectInstructions']>,
): string =>
  instructions
    .map(
      ({ content, source }) =>
        `<project_instructions source="${escapeXmlAttr(source)}">\n${escapeXmlContent(content)}\n</project_instructions>`,
    )
    .join('\n\n');

const renderGroupContext = (group: NonNullable<MessagesEngineParams['agentGroup']>): string => {
  const members = group.members ? formatGroupMembers(group.members, group.currentAgentId) : '';
  const content = groupContextTemplate
    .replace('{{AGENT_NAME}}', group.currentAgentName || '')
    .replace('{{AGENT_ROLE}}', group.currentAgentRole || '')
    .replace('{{AGENT_ID}}', group.currentAgentId || '')
    .replace('{{GROUP_TITLE}}', group.groupTitle || '')
    .replace('{{SYSTEM_PROMPT}}', group.systemPrompt || '')
    .replace('{{GROUP_MEMBERS}}', members);

  return `<group_context>\n${content}\n</group_context>`;
};

const isGroupContextEnabled = (group: MessagesEngineParams['agentGroup']): boolean =>
  Boolean(
    (group?.agentMap && Object.keys(group.agentMap).length > 0) ||
    group?.currentAgentId ||
    group?.members,
  );

const addAgentManagementContexts = (
  context: AgentManagementContext | undefined,
  mentionedAgents: AgentManagementContext['mentionedAgents'],
  add: (candidate: OnDemandDynamicCandidate) => void,
) => {
  const formatted = context ? formatAgentManagementContext(context) : null;
  if (formatted) {
    add(
      createOnDemandDynamicCandidate({
        content: formatted,
        firstTurnEligible: true,
        key: 'runtime:agent-management',
        kind: 'environment',
        priority: 940,
        relevance: 1,
        required: false,
        source: { id: 'agent-management', type: 'system' },
      }),
    );
  }

  const effectiveMentionedAgents = mentionedAgents ?? context?.mentionedAgents;
  if (effectiveMentionedAgents?.length) {
    add(
      createOnDemandDynamicCandidate({
        content: formatMentionedAgentsContext(effectiveMentionedAgents),
        firstTurnEligible: true,
        key: 'runtime:agent-management:mentioned-agents',
        kind: 'environment',
        priority: 950,
        relevance: 1,
        required: false,
        source: { id: 'mentioned-agents', type: 'system' },
      }),
    );
  }
};

const addBuilderContexts = (
  params: MessagesEngineParams,
  add: (candidate: OnDemandDynamicCandidate) => void,
) => {
  const contexts: Array<{
    content: string;
    id: string;
    key: string;
    priority: number;
  }> = [];

  if (params.agentBuilderContext) {
    contexts.push({
      content: formatAgentContext(params.agentBuilderContext),
      id: 'agent-builder',
      key: 'runtime:agent-builder',
      priority: 930,
    });
  }

  if (params.groupAgentBuilderContext) {
    contexts.push({
      content: formatGroupAgentBuilderContext(params.groupAgentBuilderContext),
      id: 'group-agent-builder',
      key: 'runtime:group-agent-builder',
      priority: 930,
    });
  }

  for (const context of contexts) {
    if (!context.content) continue;
    add(
      createOnDemandDynamicCandidate({
        content: context.content,
        firstTurnEligible: true,
        key: context.key,
        kind: 'environment',
        priority: context.priority,
        relevance: 1,
        required: false,
        source: { id: context.id, type: 'system' },
      }),
    );
  }
};

const addEnvironmentContext = (
  content: string | null | undefined,
  input: {
    id: string;
    key: string;
    priority: number;
  },
  add: (candidate: OnDemandDynamicCandidate) => void,
) => {
  if (!content) return;

  add(
    createOnDemandDynamicCandidate({
      content,
      firstTurnEligible: true,
      key: input.key,
      kind: 'environment',
      priority: input.priority,
      relevance: 1,
      required: false,
      source: { id: input.id, type: 'system' },
    }),
  );
};

/**
 * Runtime and task context that used to be injected by the legacy pipeline.
 * The on-demand mode keeps the stable system message untouched, so these
 * instruction-bearing facts travel in the post-user dynamic suffix instead of
 * disappearing from the request.
 */
export const collectOnDemandRuntimeContextCandidates = (input: {
  currentUserMessage: string;
  hasRetrievedExpertise: boolean;
  params: MessagesEngineParams;
}): OnDemandDynamicCandidate[] => {
  const { currentUserMessage, hasRetrievedExpertise, params } = input;
  const candidates: OnDemandDynamicCandidate[] = [];
  const seenKeys = new Set<string>();
  const add = (candidate: OnDemandDynamicCandidate) => {
    if (seenKeys.has(candidate.entry.key)) return;
    seenKeys.add(candidate.entry.key);
    candidates.push(candidate);
  };

  if (params.forceFinish) {
    add(
      createOnDemandDynamicCandidate({
        content: FORCE_FINISH_SUMMARY_CONTENT,
        firstTurnEligible: true,
        key: 'runtime:force-finish',
        kind: 'safety',
        priority: 1_000,
        relevance: 1,
        required: true,
        source: { id: 'force-finish', type: 'system' },
      }),
    );
  }

  if (params.projectInstructions?.length) {
    add(
      createOnDemandDynamicCandidate({
        content: renderProjectInstructions(params.projectInstructions),
        firstTurnEligible: true,
        key: 'runtime:project-instructions',
        kind: 'explicit_constraint',
        priority: 990,
        relevance: 1,
        required: true,
        source: { id: 'project-instructions', type: 'system' },
      }),
    );
  }

  if (params.planTodo?.enabled && params.planTodo.plan && !params.planTodo.plan.completed) {
    add(
      createOnDemandDynamicCandidate({
        content: formatPlan(params.planTodo.plan),
        firstTurnEligible: true,
        key: `runtime:plan:${params.planTodo.plan.id}`,
        kind: 'environment',
        priority: 980,
        relevance: 1,
        required: true,
        source: { id: params.planTodo.plan.id, type: 'system' },
      }),
    );
  }

  const todos =
    params.stepContext?.todos !== undefined
      ? params.stepContext.todos
      : params.planTodo?.enabled
        ? params.planTodo.todos
        : undefined;
  if (todos && params.planTodo?.injectTodos !== false) {
    const content = formatTodos(todos);
    if (content) {
      add(
        createOnDemandDynamicCandidate({
          content,
          firstTurnEligible: true,
          key: 'runtime:todos',
          kind: 'environment',
          priority: 970,
          relevance: 1,
          required: true,
          source: { id: 'todos', type: 'system' },
        }),
      );
    }
  }

  addEnvironmentContext(
    params.historySummary
      ? (params.formatHistorySummary ?? formatHistorySummary)(params.historySummary)
      : undefined,
    { id: 'history-summary', key: 'runtime:history-summary', priority: 960 },
    add,
  );

  addEnvironmentContext(
    params.connectorOwnershipNote,
    { id: 'connector-ownership', key: 'runtime:connector-ownership', priority: 955 },
    add,
  );

  addEnvironmentContext(
    params.evalContext?.envPrompt,
    { id: 'eval', key: 'runtime:eval', priority: 950 },
    add,
  );

  addEnvironmentContext(
    params.botPlatformContext ? formatBotPlatformContext(params.botPlatformContext) : undefined,
    { id: 'bot-platform', key: 'runtime:bot-platform', priority: 945 },
    add,
  );

  addEnvironmentContext(
    params.workspaceContext ? workspaceContextPrompt(params.workspaceContext) : undefined,
    { id: 'workspace', key: 'runtime:workspace', priority: 940 },
    add,
  );

  const groupContextEnabled = isGroupContextEnabled(params.agentGroup);
  if (groupContextEnabled && params.agentGroup) {
    addEnvironmentContext(
      renderGroupContext(params.agentGroup),
      { id: 'agent-group', key: 'runtime:agent-group', priority: 935 },
      add,
    );
  }

  if (!groupContextEnabled) {
    addEnvironmentContext(
      agentIdentityPrompt(params.agentIdentity ?? {}),
      { id: 'agent-identity', key: 'runtime:agent-identity', priority: 930 },
      add,
    );
  }

  addBuilderContexts(params, add);

  if (params.enableAgentMode !== false) {
    addAgentManagementContexts(
      params.agentManagementContext,
      params.initialContext?.mentionedAgents,
      add,
    );
  }

  addEnvironmentContext(
    params.discordContext ? formatDiscordContext(params.discordContext) : undefined,
    { id: 'discord', key: 'runtime:discord', priority: 920 },
    add,
  );

  addEnvironmentContext(
    params.onboardingContext?.phaseGuidance
      ? formatOnboardingContext(params.onboardingContext)
      : undefined,
    { id: 'onboarding', key: 'runtime:onboarding', priority: 910 },
    add,
  );

  addEnvironmentContext(
    params.topicReferences?.length ? formatTopicReferences(params.topicReferences) : undefined,
    { id: 'topic-references', key: 'runtime:topic-references', priority: 900 },
    add,
  );

  addEnvironmentContext(
    params.initialContext?.activeTopicDocument?.documentId
      ? formatActiveTopicDocumentContext(params.initialContext.activeTopicDocument)
      : undefined,
    { id: 'active-topic-document', key: 'runtime:active-topic-document', priority: 915 },
    add,
  );

  addEnvironmentContext(
    params.initialContext?.goalOverview
      ? buildGoalOverviewPrompt(params.initialContext.goalOverview)
      : undefined,
    { id: 'goal-overview', key: 'runtime:goal-overview', priority: 915 },
    add,
  );

  addEnvironmentContext(
    params.initialContext?.projectContext?.contextPrompt,
    { id: 'project', key: 'runtime:project', priority: 900 },
    add,
  );

  addEnvironmentContext(
    params.initialContext?.taskManager?.contextPrompt,
    { id: 'task-manager', key: 'runtime:task-manager', priority: 900 },
    add,
  );

  if (!hasRetrievedExpertise && params.enableExpertise && params.expertise?.renderedContext) {
    const relevance = scoreLexicalRelevance(currentUserMessage, params.expertise.renderedContext);
    if (relevance >= 0.2) {
      add(
        createOnDemandDynamicCandidate({
          content: params.expertise.renderedContext,
          firstTurnEligible: true,
          key: `runtime:expertise:${params.expertise.contentHash}`,
          kind: 'approved_expertise',
          priority: 890,
          relevance,
          required: false,
          source: { id: 'expertise', type: 'agent' },
          sourceVersion: params.expertise.contentHash,
        }),
      );
    }
  }

  return candidates;
};
