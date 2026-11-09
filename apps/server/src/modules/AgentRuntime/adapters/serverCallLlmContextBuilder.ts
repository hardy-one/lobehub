import {
  type AgentState,
  type CallLLMPayload,
  selectEnableExpertise,
  selectExpertise,
} from '@lobechat/agent-runtime';
import { GroupAgentBuilderIdentifier } from '@lobechat/builtin-tool-group-agent-builder';
import type { ResolvedToolSet } from '@lobechat/context-engine';
import { buildOnDemandTraceMetadata, hashContent } from '@lobechat/context-engine/onDemand';
import { gatherContextFacts } from '@lobechat/mecha';
import type { ChatStreamPayload } from '@lobechat/model-runtime';
import { SpanStatusCode } from '@lobechat/observability-otel/api';
import {
  buildContextEngineeringAttributes,
  CONTEXT_ENGINEERING_SPAN_NAME,
  tracer as agentRuntimeTracer,
} from '@lobechat/observability-otel/modules/agent-runtime';
import type {
  OnDemandActivatedToolBundleMetadata,
  OnDemandContextMetadata,
  OnDemandDocumentCard,
  UIChatMessage,
} from '@lobechat/types';
import { resolveContextMode } from '@lobechat/types';

import { serverMessagesEngine } from '@/server/modules/Mecha/ContextEngineering';
import {
  createServerContextFactProviders,
  resolveServerConnectorFeatures,
} from '@/server/modules/Mecha/ContextEngineering/providers';
import { AgentDocumentsService } from '@/server/services/agentDocuments';
import { retrieveOnDemandServerContext } from '@/server/services/onDemandContext/retrieval';
import { getOrLoadOnDemandRetrieval } from '@/server/services/onDemandContext/turnCache';
import { resolveBuilderGroupId } from '@/server/services/toolExecution/serverRuntimes/groupAgentBuilderTarget';

import type { RuntimeExecutorContext } from '../context';
import { log } from '../executorHelpers';
import {
  resolveServerCallLlmContextHints,
  type ServerCallLlmContextHints,
} from './serverCallLlmContextHints';
import type { ServerCallLlmTooling } from './serverCallLlmTooling';

interface BuildServerCallLlmContextInput {
  ctx: RuntimeExecutorContext;
  llmPayload: CallLLMPayload;
  model: string;
  provider: string;
  state: AgentState;
  tooling: ServerCallLlmTooling;
}

const TODO_REMINDER_INTERVAL = 10;
const TODO_MUTATION_APIS = new Set(['clearTodos', 'createTodos', 'updateTodos']);

const hasTrailingTodoMutation = (messages: UIChatMessage[]) => {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== 'tool') return false;

    if (
      message.plugin?.identifier === 'lobe-agent' &&
      TODO_MUTATION_APIS.has(message.plugin.apiName)
    ) {
      return true;
    }
  }

  return false;
};

export interface ServerCallLlmContextBuildResult {
  contextMetadata?: OnDemandContextMetadata;
  preserveThinkingForPayload?: boolean;
  processedMessages: ChatStreamPayload['messages'];
  resolvedExtendParams?: ServerCallLlmContextHints['resolvedExtendParams'];
  resolvedTools?: ResolvedToolSet;
  shouldReplayAssistantReasoning: boolean;
  /** An explicit operation-level `stream` wins; otherwise the agent's chat config. */
  stream?: boolean;
}

const findCurrentUserMessage = (
  messages: readonly { content: string; id?: string; role: string }[],
): { index: number; message: { content: string; id?: string; role: string } } | undefined => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'user') return { index, message };
  }
};

const buildActivatedToolBundles = (state: AgentState): OnDemandActivatedToolBundleMetadata[] => {
  const discoveryPool = state.operationToolSet?.discoveryPool;

  return (state.activatedStepTools ?? []).flatMap((activated) => {
    const bundle = discoveryPool?.bundles[activated.id];
    const capability = activated.capability;
    if (!capability || !bundle) return [];

    return [
      {
        activatedAtStep: activated.activatedAtStep,
        capabilityHash: capability.hash,
        capabilityVersion: capability.version,
        identifier: capability.identifier,
        manifestHash: hashContent(activated.manifest ?? bundle.manifest),
        source: activated.source,
      },
    ];
  });
};

export const buildServerCallLlmContext = async ({
  ctx,
  llmPayload,
  model,
  provider,
  state,
  tooling,
}: BuildServerCallLlmContextInput): Promise<ServerCallLlmContextBuildResult> => {
  const agentConfig = state.world?.agent;
  if (!agentConfig) {
    return {
      processedMessages: llmPayload.messages as ChatStreamPayload['messages'],
      shouldReplayAssistantReasoning: false,
    };
  }

  const { operationId, stepIndex } = ctx;
  const { resolved, resolvedSkills, toolDiscoveryConfig, activeDeviceId, executionTarget } =
    tooling;
  const contextHints = await resolveServerCallLlmContextHints({
    ctx,
    llmPayload,
    model,
    provider,
    world: state.world,
  });
  const {
    capabilities,
    enableAgentMode,
    historyCount,
    messagesForContext,
    modelDisplayName,
    modelKnowledgeCutoff,
    preserveThinkingForPayload,
    resolvedExtendParams,
    shouldReplayAssistantReasoning,
  } = contextHints;
  const agentId = state.origin?.agentId;
  const contextMode =
    state.metadata?.contextMode === 'on-demand'
      ? 'on-demand'
      : resolveContextMode(agentConfig.chatConfig, {
          supportToolUse: capabilities.isCanUseFC?.(model, provider) ?? true,
        });

  const topicId = ctx.topicId ?? state.origin?.topicId;
  // `<current_group_context>` must describe the group the builder tools will
  // write to — after a `createGroup` that is the new group, not the pinned one.
  const editingGroupId =
    ctx.serverDB && ctx.userId && resolved.enabledToolIds.includes(GroupAgentBuilderIdentifier)
      ? await resolveBuilderGroupId({
          db: ctx.serverDB,
          editingGroupId: state.origin?.editingGroupId,
          threadId: state.origin?.threadId,
          topicId,
          userId: ctx.userId,
          workspaceId: state.origin?.workspaceId ?? ctx.workspaceId,
        })
      : state.origin?.editingGroupId;
  // Which facts this turn needs is decided by the shared rules; the server
  // only answers the lookups they ask for.
  const facts = await gatherContextFacts(
    {
      activeDeviceId,
      agent: {
        chatConfig: agentConfig.chatConfig,
        description: agentConfig.description,
        name: agentConfig.name,
        slug: agentConfig.slug,
        title: agentConfig.title,
      },
      agentId,
      disabledPluginIds: state.world?.disabledPluginIds,
      editingAgentId: state.origin?.editingAgentId,
      editingGroupId,
      enabledToolIds: resolved.enabledToolIds,
      executionTarget,
      features: resolveServerConnectorFeatures(),
      includeRecentAgents: state.origin?.trigger !== 'channel',
      isSubAgent: state.origin?.lineage?.isSubAgent === true,
      mentionedAgents: (state as any).initialContext?.initialContext?.mentionedAgents,
      messages: messagesForContext,
      shareVisitor: state.principal?.actor?.shareVisitor ?? ctx.agentShareVisitor,
      topicId,
      workspaceId: state.origin?.workspaceId ?? ctx.workspaceId,
    },
    createServerContextFactProviders({ ctx, state }),
  );

  const currentUserMessage = findCurrentUserMessage(messagesForContext);
  let onDemandRetrieval;
  let documentCards: OnDemandDocumentCard[] | undefined;
  if (contextMode === 'on-demand' && currentUserMessage && ctx.serverDB && ctx.userId) {
    const memoryEffort = (agentConfig.chatConfig as { memory?: { effort?: string } } | undefined)
      ?.memory?.effort as 'high' | 'low' | 'medium' | undefined;
    const cached = await getOrLoadOnDemandRetrieval({
      cache: ctx.onDemandRetrievalCache,
      currentUserMessage: currentUserMessage.message.content,
      load: () =>
        retrieveOnDemandServerContext({
          agentId,
          currentUserMessage: currentUserMessage.message.content,
          db: ctx.serverDB!,
          effort: memoryEffort,
          memoryEnabled:
            typeof state.metadata?.memoryEnabled === 'boolean'
              ? state.metadata.memoryEnabled
              : Boolean(state.world?.userMemory?.memories),
          userId: ctx.userId!,
          workspaceId: state.origin?.workspaceId ?? ctx.workspaceId,
        }),
      messageId: currentUserMessage.message.id,
      messageIndex: currentUserMessage.index,
    });
    ctx.onDemandRetrievalCache = cached;
    onDemandRetrieval = cached.batch;

    if (agentId) {
      try {
        const documentService = new AgentDocumentsService(
          ctx.serverDB!,
          ctx.userId!,
          state.origin?.workspaceId ?? ctx.workspaceId,
        );
        const documents = await documentService.listDocuments(agentId, 'all');
        documentCards = documents.slice(0, 50).map((document) => ({
          description: document.description ?? undefined,
          documentId: document.documentId,
          filename: document.filename,
          id: document.id,
          sourceType: document.sourceType,
          title: document.title,
          updatedAt: document.updatedAt.toISOString(),
        }));
      } catch (error) {
        // Document discovery is optional; a listing failure must not block the turn.
        log('Failed to build on-demand document cards: %O', error);
      }
    }
  }

  const contextEngineInput = {
    additionalContexts: llmPayload.additionalContexts,
    attachmentPreviewFileIds: llmPayload.attachmentPreviewFileIds,
    contextMode,
    ...(contextMode === 'on-demand' &&
      onDemandRetrieval && {
        onDemand: { retrieval: onDemandRetrieval },
      }),
    agentDocuments: facts.agentDocuments,
    // Identity lives on the agent row, not in the prompt text — inject it so
    // the model introduces itself by the user-given name.
    agentIdentity: { name: agentConfig.name ?? undefined, title: agentConfig.title ?? undefined },
    // The agent's own accounts + inbox, as first-class state. This is what
    // replaces a resident mailbox tool: the model is told who it is and what
    // arrived instead of having to ask.
    agentAccountContext: facts.step.agentAccountContext,
    ...(facts.step.agentBuilderContext && { agentBuilderContext: facts.step.agentBuilderContext }),
    agentGroup: state.world?.group,
    agentManagementContext: facts.step.agentManagementContext,
    additionalVariables: {
      ...state.binding?.device?.systemInfo,
      ...facts.variables,
      // Only override the generator's 'en-US' locale fallback when the user info
      // fetch actually resolved a language — an empty string would render blank.
      ...(facts.variables.language && { locale: facts.variables.language as string }),
    },
    userTimezone: state.world?.userTimezone,
    capabilities,
    botPlatformContext: state.world?.channel?.botPlatform,
    documentCards,
    ...(facts.step.workspaceContext && { workspaceContext: facts.step.workspaceContext }),
    discordContext: state.world?.channel?.discord,
    enableExpertise: selectEnableExpertise(state),
    enableHistoryCount: agentConfig.chatConfig?.enableHistoryCount ?? undefined,
    enableStaleToolResultTrim: agentConfig.chatConfig?.enableStaleToolResultTrim ?? undefined,
    evalContext: state.world?.eval,
    expertise: selectExpertise(state),
    forceFinish: state.forceFinish,
    ...(facts.step.groupAgentBuilderContext && {
      groupAgentBuilderContext: facts.step.groupAgentBuilderContext,
    }),
    historyCount,
    initialContext: (state as any).initialContext?.initialContext,
    knowledge: {
      fileContents: agentConfig.files
        ?.filter((file: { enabled?: boolean | null }) => file.enabled === true)
        .map(
          (file: {
            content?: string | null;
            id?: string;
            name?: string;
            originalCharCount?: number;
          }) => ({
            content: file.content ?? '',
            fileId: file.id ?? '',
            filename: file.name ?? '',
            originalChars: file.originalCharCount,
          }),
        ),
      knowledgeBases: agentConfig.knowledgeBases
        ?.filter((knowledgeBase: { enabled?: boolean | null }) => knowledgeBase.enabled === true)
        .map((knowledgeBase: { id?: string; name?: string }) => ({
          id: knowledgeBase.id ?? '',
          name: knowledgeBase.name ?? '',
        })),
    },
    messages: messagesForContext,
    model,
    modelDisplayName,
    modelKnowledgeCutoff,
    provider,
    ...(facts.step.planTodo && {
      planTodo: {
        ...facts.step.planTodo,
        injectTodos:
          hasTrailingTodoMutation(messagesForContext) || stepIndex % TODO_REMINDER_INTERVAL === 0,
      },
    }),
    connectorOwnershipNote: state.world?.connectorOwnershipNote,
    projectInstructions: state.world?.projectInstructions,
    systemRole: agentConfig.systemRole ?? undefined,
    toolDiscoveryConfig,
    toolsConfig: {
      discoveryCards: state.operationToolSet?.discoveryPool?.cards,
      manifests: Object.values(resolved.promptManifestMap),
      tools: resolved.enabledToolIds,
    },
    // On-demand retrieves only current-turn matches; legacy persona stays default-only.
    userMemory: contextMode === 'on-demand' ? undefined : state.world?.userMemory,
    ...(resolvedSkills?.enabledSkills?.length && {
      skillsConfig: { enabledSkills: resolvedSkills.enabledSkills },
    }),
    enableAgentMode,
    ...(facts.step.topicReferences && { topicReferences: facts.step.topicReferences }),
    ...(facts.step.documentReferences && {
      documentReferences: facts.step.documentReferences,
    }),
    ...(facts.step.onboardingContext && { onboardingContext: facts.step.onboardingContext }),
  };

  const contextResult = await agentRuntimeTracer.startActiveSpan(
    CONTEXT_ENGINEERING_SPAN_NAME,
    {
      attributes: buildContextEngineeringAttributes({
        hasImages: (messagesForContext as Array<{ content?: unknown }>).some(
          (message) =>
            Array.isArray(message.content) &&
            (message.content as Array<{ type?: string }>).some(
              (part) => part?.type === 'image_url',
            ),
        ),
        historyCompressed:
          Array.isArray(messagesForContext) &&
          messagesForContext.some(
            (message: { role?: string }) => message?.role === 'compressedGroup',
          ),
        knowledgeCount:
          (contextEngineInput.knowledge?.knowledgeBases?.length ?? 0) +
          (contextEngineInput.knowledge?.fileContents?.length ?? 0),
        knowledgeInjected:
          (contextEngineInput.knowledge?.knowledgeBases?.length ?? 0) > 0 ||
          (contextEngineInput.knowledge?.fileContents?.length ?? 0) > 0,
        memoryInjected:
          contextMode === 'on-demand'
            ? Boolean(onDemandRetrieval?.candidates.length)
            : Boolean(contextEngineInput.userMemory?.memories),
        messageCount: messagesForContext.length,
        operationId,
        stepIndex,
        systemRoleLength: contextEngineInput.systemRole?.length,
        toolCount: contextEngineInput.toolsConfig?.tools?.length ?? 0,
      }),
    },
    async (ceSpan) => {
      try {
        const result = await serverMessagesEngine(contextEngineInput);
        ceSpan.setAttribute('lobehub.context.message_count', result.messages.length);
        return result;
      } catch (error) {
        ceSpan.recordException(error as Error);
        ceSpan.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        ceSpan.end();
      }
    },
  );

  const {
    messages: _inputMsgs,
    toolsConfig: _toolsConfig,
    onDemand: _onDemand,
    ...contextEngineInputLite
  } = contextEngineInput;
  const onDemandTraceMetadata = contextResult.onDemandContext
    ? buildOnDemandTraceMetadata({
        activatedToolBundles: buildActivatedToolBundles(state),
        context: contextResult.onDemandContext,
        rawSystemRole: contextEngineInput.systemRole ?? '',
      })
    : undefined;
  ctx.tracingContextEngine?.(
    {
      ...contextEngineInputLite,
      ...(contextResult.onDemandContext && {
        onDemandContext: contextResult.onDemandContext,
      }),
      toolCount:
        contextResult.onDemandContext?.bootstrapToolIds.length ?? _toolsConfig?.tools?.length ?? 0,
    },
    contextResult.messages,
    onDemandTraceMetadata ?? contextResult.metadata,
  );

  return {
    contextMetadata: contextResult.onDemandContext,
    preserveThinkingForPayload,
    processedMessages: contextResult.messages,
    resolvedTools: tooling.resolved,
    resolvedExtendParams,
    shouldReplayAssistantReasoning,
    stream: ctx.stream ?? contextHints.stream,
  };
};
