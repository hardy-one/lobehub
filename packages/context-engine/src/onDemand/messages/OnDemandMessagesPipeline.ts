import type {
  OnDemandAppendedMessage,
  OnDemandBootstrapToolMetadata,
  OnDemandContextMetadata,
  OnDemandDynamicCandidateConflictMetadata,
  OnDemandDynamicEntryMetadata,
  OnDemandMessageSegmentMetadata,
  OnDemandRetrievalMetadata,
  OnDemandTokenMetadata,
  OpenAIChatMessage,
} from '@lobechat/types';
import {
  compareOnDemandDynamicEntries,
  ON_DEMAND_BOOTSTRAP_IDENTIFIERS,
  ON_DEMAND_PROTOCOL_VERSION,
} from '@lobechat/types';
import { estimateTokenCount } from 'tokenx';

import type { MessagesEngineParams, MessagesEngineResult } from '../../engine/messages/types';
import { CompressedGroupRoleTransformProcessor } from '../../processors/CompressedGroupRoleTransform';
import { GroupMessageFlattenProcessor } from '../../processors/GroupMessageFlatten';
import { ToolCallProcessor } from '../../processors/ToolCall';
import { LocalSystemToolSnapshotInjector } from '../../providers/LocalSystemToolSnapshotInjector';
import type { ContextBuckets, PipelineContextMetadata } from '../../types';
import { buildOnDemandBootstrapToolSet } from '../bootstrapTooling';
import { hashContent } from '../canonical';
import {
  buildOnDemandProtocol,
  buildOnDemandStablePrefix,
  ON_DEMAND_PROTOCOL_CONTENT,
} from '../protocolBuilder';
import { retrieveOnDemandContext } from '../retrieval/ranking';
import { buildOnDemandCandidatesFromUserMemory } from '../retrieval/userMemory';
import {
  collectOnDemandDynamicCandidates,
  mergeOnDemandDynamicCandidates,
  ON_DEMAND_FIRST_TURN_RELEVANCE,
  type OnDemandDynamicCandidate,
} from './dynamicCandidates';
import { collectOnDemandMessageContextCandidates } from './messageContextCandidates';
import { collectOnDemandRuntimeContextCandidates } from './runtimeContextCandidates';

export interface OnDemandMessagesOptions {
  genToolCallingName?: (identifier: string, apiName: string, type?: string) => string;
}

const messageText = (content: unknown): string =>
  typeof content === 'string' ? content : JSON.stringify(content ?? '');

const concatenateMessageText = (messages: readonly { content?: unknown }[]): string =>
  messages.map((message) => messageText(message.content)).join('');

const buildContextBuckets = (messages: readonly OpenAIChatMessage[]): ContextBuckets => ({
  chats: messages
    .slice(1)
    .map((message) => messageText(message.content))
    .join(''),
  historySummary: '',
  systemRole: messageText(messages[0]?.content),
  tools: '',
});

const buildMessageSegments = ({
  appendedMessages,
  currentUserSourceIndex,
  estimate,
  messages,
  sourceMessageCount,
}: {
  appendedMessages: readonly OnDemandAppendedMessage[];
  currentUserSourceIndex: number;
  estimate: (content: string) => number;
  messages: readonly OpenAIChatMessage[];
  sourceMessageCount: number;
}): OnDemandMessageSegmentMetadata[] => {
  const segments: OnDemandMessageSegmentMetadata[] = [];
  const system = messages[0];
  const systemContent = messageText(system?.content);

  segments.push({
    contentHash: hashContent(systemContent),
    estimatedTokens: estimate(systemContent),
    index: 0,
    role: system?.role ?? 'system',
    source: 'stable_system',
  });

  for (let sourceIndex = 0; sourceIndex < sourceMessageCount; sourceIndex += 1) {
    const message = messages[sourceIndex + 1];
    const content = messageText(message?.content);
    const source = sourceIndex === currentUserSourceIndex ? 'current_user' : 'history';

    segments.push({
      contentHash: hashContent(message?.content),
      estimatedTokens: estimate(content),
      index: sourceIndex + 1,
      role: message?.role ?? 'user',
      source,
    });
  }

  appendedMessages.forEach((appendedMessage, offset) => {
    const index = sourceMessageCount + 1 + offset;
    const message = messages[index];
    const content = messageText(message?.content);
    const metadata = appendedMessage.metadata;

    segments.push({
      contentHash: hashContent(message?.content),
      estimatedTokens: estimate(content),
      entryKey: metadata.entryKey,
      index,
      kind: metadata.kind,
      role: message?.role ?? 'user',
      source: 'dynamic_suffix',
      sourceId: metadata.source.id,
      sourceType: metadata.source.type,
    });
  });

  return segments;
};

/**
 * Convert UI rows to the wire shape without changing any text. Only protocol
 * fields already present on the row are forwarded; timestamps and renderer
 * metadata are intentionally not sent to the model.
 */
const toOpenAIMessage = (message: MessagesEngineParams['messages'][number]): OpenAIChatMessage => {
  const source = message as unknown as Record<string, unknown>;
  const role = source.role;
  if (role !== 'assistant' && role !== 'system' && role !== 'tool' && role !== 'user') {
    throw new Error(`On-demand context does not support message role: ${String(role)}`);
  }

  return {
    content: source.content as OpenAIChatMessage['content'],
    role,
    ...(source.name !== undefined && { name: source.name as string }),
    ...(source.tool_call_id !== undefined && {
      tool_call_id: source.tool_call_id as string,
    }),
    ...(source.tool_calls !== undefined && {
      tool_calls: source.tool_calls as OpenAIChatMessage['tool_calls'],
    }),
  };
};

const extractUserMessageText = (content: unknown): string | undefined => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;

  const text = content
    .filter(
      (part): part is { text: string; type: 'text' } =>
        !!part &&
        typeof part === 'object' &&
        'type' in part &&
        part.type === 'text' &&
        'text' in part &&
        typeof part.text === 'string',
    )
    .map((part) => part.text)
    .join('\n\n');

  return text || undefined;
};

const findCurrentUserMessage = (
  messages: MessagesEngineParams['messages'],
):
  | { index: number; message: MessagesEngineParams['messages'][number]; text?: string }
  | undefined => {
  const index = messages.findLastIndex((message) => message.role === 'user');
  if (index === -1) return undefined;

  return { index, message: messages[index], text: extractUserMessageText(messages[index].content) };
};

const estimateActiveToolContracts = (params: MessagesEngineParams): number => {
  const enabledIds = new Set(params.toolsConfig?.tools ?? []);
  const bootstrapIds = new Set<string>(ON_DEMAND_BOOTSTRAP_IDENTIFIERS);

  return (params.toolsConfig?.manifests ?? [])
    .filter(
      (manifest) => enabledIds.has(manifest.identifier) && !bootstrapIds.has(manifest.identifier),
    )
    .reduce((sum, manifest) => sum + estimateTokenCount(JSON.stringify(manifest)), 0);
};

const buildDynamicEntryMetadata = (
  candidates: readonly OnDemandDynamicCandidate[],
  includedKeys: ReadonlySet<string>,
): OnDemandDynamicEntryMetadata[] => {
  return [...candidates]
    .sort((a, b) => compareOnDemandDynamicEntries(a.entry, b.entry))
    .map(({ entry, firstTurnEligible }) => {
      const included = includedKeys.has(entry.key);
      const dropReason = included
        ? undefined
        : firstTurnEligible
          ? ('low_relevance' as const)
          : ('first_turn_body_deferred' as const);

      return {
        ...(dropReason && { dropReason }),
        estimatedTokens: entry.estimatedTokens,
        included,
        key: entry.key,
        kind: entry.kind,
        priority: entry.priority,
        provenance: entry.provenance,
        relevance: entry.relevance,
        required: entry.required,
        source: entry.source,
      };
    });
};

const buildOnDemandMetadata = ({
  bootstrapTools,
  bootstrapToolCount,
  candidateConflicts,
  currentUserHash,
  dynamicEntries,
  messageSegments,
  rawSystemRole,
  retrieval,
  stablePrefixHash,
  tokens,
}: {
  bootstrapTools: readonly OnDemandBootstrapToolMetadata[];
  bootstrapToolCount: number;
  candidateConflicts?: readonly OnDemandDynamicCandidateConflictMetadata[];
  currentUserHash?: string;
  dynamicEntries: readonly OnDemandDynamicEntryMetadata[];
  messageSegments: readonly OnDemandMessageSegmentMetadata[];
  rawSystemRole: string;
  retrieval?: OnDemandRetrievalMetadata;
  stablePrefixHash: string;
  tokens: OnDemandTokenMetadata;
}): OnDemandContextMetadata => ({
  bootstrapTools,
  bootstrapToolIds: ON_DEMAND_BOOTSTRAP_IDENTIFIERS.slice(0, bootstrapToolCount),
  ...(candidateConflicts?.length && { candidateConflicts }),
  contextMode: 'on-demand',
  ...(currentUserHash && { currentUserMessageHash: currentUserHash }),
  dynamicEntries,
  messageSegments,
  protocolVersion: ON_DEMAND_PROTOCOL_VERSION,
  rawSystemRoleHash: hashContent(rawSystemRole),
  ...(retrieval && { retrieval }),
  stablePrefixHash,
  tokens,
});

/**
 * Third-mode assembly. It deliberately does not run the legacy injector
 * pipeline: the stable system message is only the raw Agent Prompt plus the
 * fixed protocol, and all mutable context is appended after the current user
 * turn. Runtime formatters are reused so legacy contexts keep their semantics.
 */
export class OnDemandMessagesPipeline {
  constructor(
    private readonly params: MessagesEngineParams,
    private readonly options: OnDemandMessagesOptions = {},
  ) {}

  async process(): Promise<MessagesEngineResult> {
    const startTime = performance.now();
    const processorDurations: Record<string, number> = {};
    const measure = <T>(name: string, task: () => T): T => {
      const startedAt = performance.now();
      try {
        return task();
      } finally {
        processorDurations[name] = Math.round((performance.now() - startedAt) * 100) / 100;
      }
    };
    const measureAsync = async <T>(name: string, task: () => Promise<T>): Promise<T> => {
      const startedAt = performance.now();
      try {
        return await task();
      } finally {
        processorDurations[name] = Math.round((performance.now() - startedAt) * 100) / 100;
      }
    };

    const flattenedMessages = await measureAsync('GroupMessageFlattenProcessor', () =>
      new GroupMessageFlattenProcessor().process({
        initialState: { messages: [] },
        isAborted: false,
        messages: this.params.messages as any[],
        metadata: {},
      }),
    );
    const snapshotMessages = await measureAsync('LocalSystemToolSnapshotInjector', () =>
      new LocalSystemToolSnapshotInjector({ enabled: true }).process({
        ...flattenedMessages,
        messages: flattenedMessages.messages as any[],
      }),
    );
    const roleTransformedMessages = await measureAsync(
      'CompressedGroupRoleTransformProcessor',
      () =>
        new CompressedGroupRoleTransformProcessor().process({
          ...snapshotMessages,
          messages: snapshotMessages.messages as any[],
        }),
    );
    const preparedMessages = await measureAsync('ToolCallProcessor', () =>
      new ToolCallProcessor({
        genToolCallingName: this.options.genToolCallingName,
        isCanUseFC: this.params.capabilities?.isCanUseFC,
        model: this.params.model,
        provider: this.params.provider,
      }).process(roleTransformedMessages),
    );
    const sourceMessages = preparedMessages.messages as MessagesEngineParams['messages'];
    const rawSystemRole = this.params.systemRole ?? '';
    const stablePrefix = measure('OnDemandStablePrefix', () =>
      buildOnDemandStablePrefix({ agentPrompt: rawSystemRole }),
    );
    const bootstrapToolSet = buildOnDemandBootstrapToolSet();
    const systemContent = rawSystemRole
      ? `${rawSystemRole}\n\n${ON_DEMAND_PROTOCOL_CONTENT}`
      : ON_DEMAND_PROTOCOL_CONTENT;
    const currentUserMatch = findCurrentUserMessage(sourceMessages);
    const currentUserText = currentUserMatch?.text;

    const estimate = (content: string) => estimateTokenCount(content);
    const activeToolContracts = estimateActiveToolContracts(this.params);

    const suppliedRetrieval = currentUserText ? this.params.onDemand?.retrieval : undefined;
    const retrieval = currentUserText
      ? retrieveOnDemandContext({
          batch: {
            candidates: suppliedRetrieval
              ? suppliedRetrieval.candidates
              : buildOnDemandCandidatesFromUserMemory(
                  this.params.userMemory?.memories,
                  currentUserText,
                ),
            durationMs: suppliedRetrieval?.durationMs,
            mode: suppliedRetrieval?.mode,
          },
          currentUserMessage: currentUserText,
        })
      : undefined;
    const dynamicCandidateMerge = measure('OnDemandDynamicCandidates', () =>
      currentUserText
        ? mergeOnDemandDynamicCandidates([
            collectOnDemandDynamicCandidates(this.params, currentUserText),
            collectOnDemandMessageContextCandidates({
              currentUserMessage: currentUserText,
              currentUserMessageIndex: currentUserMatch.index,
              messages: sourceMessages,
              params: this.params,
            }),
            collectOnDemandRuntimeContextCandidates({
              currentUserMessage: currentUserText,
              hasRetrievedExpertise:
                retrieval?.entries.some((entry) => entry.kind === 'approved_expertise') ?? false,
              params: this.params,
            }),
            (retrieval?.entries ?? []).map<OnDemandDynamicCandidate>((entry) => ({
              entry,
              firstTurnEligible: true,
            })),
          ])
        : { candidates: [], conflicts: [] },
    );
    const dynamicCandidates = dynamicCandidateMerge.candidates;
    const retrievalEntryKeys = new Set(retrieval?.entries.map((entry) => entry.key) ?? []);
    const firstTurnEntries = dynamicCandidates
      .filter(
        (candidate) =>
          candidate.firstTurnEligible &&
          (candidate.entry.required ||
            retrievalEntryKeys.has(candidate.entry.key) ||
            candidate.entry.relevance >= ON_DEMAND_FIRST_TURN_RELEVANCE),
      )
      .map((candidate) => candidate.entry);
    const protocol = currentUserText
      ? measure('OnDemandSuffix', () =>
          buildOnDemandProtocol({
            currentUserMessage: {
              content: currentUserText,
              ...(sourceMessages[currentUserMatch.index].id && {
                id: sourceMessages[currentUserMatch.index].id,
              }),
              role: 'user',
            },
            entries: firstTurnEntries,
            stablePrefix,
          }),
        )
      : undefined;
    const appendedMessages = protocol?.appendedMessages ?? [];

    const conversationMessages = sourceMessages.map(toOpenAIMessage);
    const messages: OpenAIChatMessage[] = [
      { content: systemContent, role: 'system' },
      ...conversationMessages,
      ...(appendedMessages as readonly OpenAIChatMessage[]),
    ];
    const dynamicEntries = buildDynamicEntryMetadata(
      dynamicCandidates,
      new Set(appendedMessages.map((message) => message.metadata.entryKey)),
    );
    const messageSegments = buildMessageSegments({
      appendedMessages,
      currentUserSourceIndex: currentUserMatch?.index ?? -1,
      estimate,
      messages,
      sourceMessageCount: sourceMessages.length,
    });
    const bootstrapTools: OnDemandBootstrapToolMetadata[] = bootstrapToolSet.enabledToolIds.map(
      (identifier) => {
        const manifest = bootstrapToolSet.manifestMap[identifier];
        return {
          apiNames: manifest.api.map((api) => api.name),
          identifier: identifier as OnDemandBootstrapToolMetadata['identifier'],
          manifestHash: hashContent(manifest),
        };
      },
    );
    const messageTotal = messageSegments.reduce(
      (total, segment) => total + segment.estimatedTokens,
      0,
    );
    const dynamicTokens = messageSegments
      .filter((segment) => segment.source === 'dynamic_suffix')
      .reduce((total, segment) => total + segment.estimatedTokens, 0);
    const tokens: OnDemandTokenMetadata = {
      activeToolContracts,
      bootstrapTools: estimate(JSON.stringify(bootstrapToolSet.tools)),
      currentUserMessage: currentUserText ? estimate(currentUserText) : 0,
      dynamic: dynamicTokens,
      messageTotal,
      stableSystem: messageSegments[0]?.estimatedTokens ?? 0,
    };
    const includedRetrievalCount = dynamicEntries.filter(
      (entry) => retrievalEntryKeys.has(entry.key) && entry.included,
    ).length;
    const onDemandContext = buildOnDemandMetadata({
      bootstrapTools,
      bootstrapToolCount: bootstrapToolSet.enabledToolIds.length,
      candidateConflicts: dynamicCandidateMerge.conflicts,
      currentUserHash: protocol?.currentUserMessageHash,
      dynamicEntries,
      messageSegments,
      rawSystemRole,
      ...(retrieval && {
        retrieval: {
          ...retrieval.metadata,
          includedCount: includedRetrievalCount,
        },
      }),
      stablePrefixHash: stablePrefix.hash,
      tokens,
    });
    const metadata: PipelineContextMetadata = {
      bootstrapToolIds: onDemandContext.bootstrapToolIds,
      contextBuckets: buildContextBuckets(messages),
      contextChatsBase: concatenateMessageText(conversationMessages),
      contextMode: 'on-demand',
      dynamicEntries,
      onDemandContext,
      protocolVersion: onDemandContext.protocolVersion,
      rawSystemRoleHash: onDemandContext.rawSystemRoleHash,
      stablePrefixHash: onDemandContext.stablePrefixHash,
    } as PipelineContextMetadata;

    return {
      messages,
      metadata,
      stats: {
        processedCount: Object.keys(processorDurations).length,
        processorDurations,
        totalDuration: Math.round((performance.now() - startTime) * 100) / 100,
      },
    };
  }
}

export const processOnDemandMessages = async (
  params: MessagesEngineParams,
  options?: OnDemandMessagesOptions,
): Promise<MessagesEngineResult> => new OnDemandMessagesPipeline(params, options).process();
