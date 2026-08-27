import { type ContextBuckets, MessagesEngine } from '@lobechat/context-engine';
import { buildMessagesEngineParams, type ContextSnapshot } from '@lobechat/mecha';
import { type OpenAIChatMessage } from '@lobechat/types';

import { type ServerMessagesEngineParams } from './types';

/**
 * Shape the server's per-step gathering into the host-agnostic context
 * snapshot. The assembly itself (engine parameters, placeholder generators,
 * page-agent gating) lives in `@lobechat/mecha` and is shared with the client.
 */
export const toContextSnapshot = ({
  additionalContexts,
  availableTools,
  additionalVariables,
  agentBuilderContext,
  agentDocuments,
  agentGroup,
  agentIdentity,
  agentManagementContext,
  botPlatformContext,
  capabilities,
  connectorOwnershipNote,
  discordContext,
  enableAgentMode,
  enableExpertise,
  enableHistoryCount,
  evalContext,
  expertise,
  forceFinish,
  formatHistorySummary,
  groupAgentBuilderContext,
  historyCount,
  historySummary,
  initialContext,
  inputTemplate,
  knowledge,
  messages = [],
  model,
  modelDisplayName,
  modelKnowledgeCutoff,
  promptMode,
  onboardingContext,
  pageContentContext,
  planTodo,
  projectInstructions,
  provider,
  skillsConfig,
  systemRole,
  toolsConfig,
  topicReferences,
  userMemory,
  userTimezone,
  workspaceContext,
}: ServerMessagesEngineParams): ContextSnapshot => ({
  agent: {
    documents: agentDocuments,
    enableHistoryCount,
    historyCount,
    identity: agentIdentity,
    inputTemplate,
    knowledge: { fileContents: knowledge?.fileContents, knowledgeBases: knowledge?.knowledgeBases },
    systemRole,
  },
  // Server-side file access URLs resolve to stable file-proxy URLs in production.
  fileContext: { enabled: true, includeFileUrl: true },
  model: {
    capabilities: {
      isCanUseAudio: capabilities?.isCanUseAudio,
      isCanUseFC: capabilities?.isCanUseFC,
      isCanUseVideo: capabilities?.isCanUseVideo,
      isCanUseVision: capabilities?.isCanUseVision,
    },
    displayName: modelDisplayName,
    knowledgeCutoff: modelKnowledgeCutoff,
    model,
    provider,
  },
  run: {
    additionalContexts,
    enableAgentMode,
    enableExpertise,
    promptMode,
    expertise,
    forceFinish,
    formatHistorySummary,
    historySummary,
    initialContext,
    messages,
  },
  step: {
    agentBuilderContext,
    agentManagementContext,
    groupAgentBuilderContext,
    onboardingContext,
    pageContentContext,
    planTodo,
    topicReferences,
    workspaceContext,
  },
  tools: {
    disabledToolIdentifiers: toolsConfig?.disabledToolIdentifiers,
    enabledSkills: skillsConfig?.enabledSkills,
    enabledToolIds: toolsConfig?.tools,
    availableTools,
    manifests: toolsConfig?.manifests,
  },
  variables: additionalVariables,
  world: {
    botPlatformContext,
    connectorOwnershipNote,
    discordContext,
    evalContext,
    group: agentGroup,
    projectInstructions,
    userMemory: userMemory?.memories
      ? { enabled: true, fetchedAt: userMemory.fetchedAt, memories: userMemory.memories }
      : undefined,
    userTimezone,
  },
});

/**
 * Server-side messages engine function.
 *
 * Unlike the frontend version, it receives all data as parameters instead of
 * fetching from stores, shapes them into a {@link ContextSnapshot} and runs the
 * shared context engineering core.
 */
export const serverMessagesEngine = async (
  params: ServerMessagesEngineParams,
): Promise<{
  contextBuckets?: ContextBuckets;
  messages: OpenAIChatMessage[];
}> => {
  const result = await new MessagesEngine(buildMessagesEngineParams(toContextSnapshot(params))).process();
  return {
    contextBuckets: result.metadata.contextBuckets,
    messages: result.messages,
  };
};

// Re-export types
export type {
  BotPlatformContext,
  EvalContext,
  ServerKnowledgeConfig,
  ServerMessagesEngineParams,
  ServerModelCapabilities,
  ServerToolsConfig,
  ServerUserMemoryConfig,
} from './types';
