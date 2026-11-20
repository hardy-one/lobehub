import { PageAgentIdentifier } from '@lobechat/builtin-tool-page-agent';
import type { MessagesEngineParams } from '@lobechat/context-engine';
import { ModelProvider } from 'model-bank/modelProvider';

import type { ContextSnapshot } from './types';
import { createVariableGenerators } from './variableGenerators';

const definedOnly = <T extends Record<string, unknown>>(record: T): Partial<T> =>
  Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  ) as Partial<T>;

const builtInProviders = new Set<string>(Object.values(ModelProvider));
const responsesProviders = new Set<string>([
  ModelProvider.OpenAI,
  ModelProvider.ChatGPT,
  ModelProvider.LobeHub,
]);

/**
 * Turn a {@link ContextSnapshot} into the parameters the messages engine runs
 * on. Pure: the same snapshot always yields the same parameters, so hosts
 * differ only in how they assemble the snapshot.
 */
export const buildMessagesEngineParams = (snapshot: ContextSnapshot): MessagesEngineParams => {
  const { agent, fileContext, model, run, step, tools, variables, world } = snapshot;

  const enabledToolIds = tools?.enabledToolIds;

  // All "today" values render from the wall clock in the user's timezone.
  // The eval case clock was removed together with the system-date line: time
  // now comes from per-turn message `createdAt` in TimeReminderInjector.
  const timezone = world?.userTimezone;
  const manifests = tools?.manifests;
  // The page agent's system role is only meaningful while a page is being
  // edited; hide it unless the run enabled the tool explicitly.
  const disabledToolIdentifiers =
    tools?.disabledToolIdentifiers ??
    (enabledToolIds?.includes(PageAgentIdentifier) ? undefined : [PageAgentIdentifier]);

  return {
    // --- conversation + runtime flags ---
    additionalContexts: run.additionalContexts,
    enableAgentMode: run.enableAgentMode,
    enableExpertise: run.enableExpertise,
    enableMcpAppContext: run.enableMcpAppContext,
    enableTimeReminder: run.enableTimeReminder,
    expertise: run.expertise,
    forceFinish: run.forceFinish,
    formatHistorySummary: run.formatHistorySummary,
    historySummary: run.historySummary,
    initialContext: run.initialContext,
    messages: run.messages,
    stepContext: run.stepContext,

    // --- agent definition ---
    agentDocumentChanges: agent.documentChanges,
    agentDocuments: agent.documents,
    agentIdentity: agent.identity,
    enableHistoryCount: agent.enableHistoryCount,
    enableStaleToolResultTrim: agent.enableStaleToolResultTrim,
    historyCount: agent.historyCount,
    inputTemplate: agent.inputTemplate,
    knowledge: agent.knowledge,
    ...(agent.revokedDocumentReads?.length && { revokedDocumentReads: agent.revokedDocumentReads }),
    systemRole: agent.systemRole,

    // --- model ---
    capabilities: model.capabilities,
    model: model.model,
    modelDisplayName: model.displayName,
    modelKnowledgeCutoff: model.knowledgeCutoff,
    provider: model.provider,

    // --- tools + skills ---
    selectedSkills: tools?.selectedSkills,
    selectedTools: tools?.selectedTools,
    ...(tools?.skillChanges && { skillChanges: tools.skillChanges }),
    toolDiscoveryConfig: tools?.toolDiscoveryConfig,
    toolsConfig: {
      // Custom provider IDs use the OpenAI-compatible runtime. Defer the final
      // decision until aliases, relays and the effective protocol are resolved.
      anchorActivatedTools:
        responsesProviders.has(model.provider) || !builtInProviders.has(model.provider),
      disabledToolIdentifiers,
      manifests,
      tools: enabledToolIds,
    },
    ...(tools?.enabledSkills?.length && { skillsConfig: { enabledSkills: tools.enabledSkills } }),

    // --- files + placeholders ---
    fileContext: fileContext ?? { enabled: true, includeFileUrl: true },
    variableGenerators: createVariableGenerators({
      model: model.model,
      provider: model.provider,
      timezone,
      variables,
    }),
    timezone,

    // --- world (frozen at creation) ---
    ...definedOnly({
      agentGroup: world?.group,
      botPlatformContext: world?.botPlatformContext,
      connectorOwnershipNote: world?.connectorOwnershipNote,
      discordContext: world?.discordContext,
      evalContext: world?.evalContext,
      projectInstructions: world?.projectInstructions,
      userMemory: world?.userMemory,
    }),

    // --- step facts (gathered per step) ---
    ...definedOnly({
      agentAccountContext: step?.agentAccountContext,
      agentBuilderContext: step?.agentBuilderContext,
      agentManagementContext: step?.agentManagementContext,
      groupAgentBuilderContext: step?.groupAgentBuilderContext,
      onboardingContext: step?.onboardingContext,
      planTodo: step?.planTodo,
      workspaceContext: step?.workspaceContext,
    }),
    ...(step?.topicReferences?.length && { topicReferences: step.topicReferences }),
    ...(step?.documentReferences?.length && { documentReferences: step.documentReferences }),
  };
};
