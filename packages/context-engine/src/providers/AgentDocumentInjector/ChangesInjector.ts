import debug from 'debug';
import { Md5 } from 'ts-md5';

import { BaseEveryUserContentProvider } from '../../base/BaseEveryUserContentProvider';
import { wrapperBlockId } from '../../injection/MessageWrapperSnapshots';
import type { Message, PipelineContext, ProcessorOptions } from '../../types';
import type { AgentDocumentChangesByMessage } from './indexSnapshot';
import { formatAgentDocumentChanges } from './indexSnapshot';

declare module '../../types' {
  interface PipelineContextMetadataOverrides {
    /** T-203 D2: deterministic wrapper identity derived from the immutable change-note source (P2). */
    agentDocChangesWrapperIds?: Array<{ fingerprint: string; id: string; messageId: string }>;
  }
}

const log = debug('context-engine:provider:AgentDocumentChangesInjector');

export interface AgentDocumentChangesInjectorConfig {
  /** Change notes keyed by the user message each was attached to. */
  changes?: AgentDocumentChangesByMessage;
  enabled?: boolean;
}

/**
 * Attaches each agent-document change note to the user message it belongs to.
 *
 * The `<agent_documents_index>` block renders a snapshot that stays fixed while
 * the prompt cache is warm (see `resolveAgentDocumentIndex`); these notes tell
 * the model what changed since. Every note stays on its own message and renders
 * the same on every later request, so earlier turns keep their cached bytes.
 *
 * T-203 D2 (M2 · pure derivation): the wrapper is a PURE FUNCTION of
 * `changes[message.id]`. That entry is the task-specified source — the persisted
 * index-snapshot projection (`agentDocumentChangesByMessage`, indexSnapshot.ts:287).
 * `noteAgentDocumentChanges` (indexSnapshot.ts:248) never rewrites an existing
 * message's note, so the same message id renders byte-identically on every
 * operation, and the `[0,k)` prefix is stable by purity of the immutable source.
 *
 * There is deliberately NO snapshot-store cache and NO "first render wins"
 * logic: a genuinely new or changed note is always rendered verbatim, so
 * functionality takes priority over cache stability (T-193 §3.1). Caching the
 * first render and discarding later changes would silently drop a real note and
 * break that rule. The trigger conditions and the `formatAgentDocumentChanges`
 * text template remain byte-for-byte unchanged (P5).
 */
export class AgentDocumentChangesInjector extends BaseEveryUserContentProvider {
  readonly name = 'AgentDocumentChangesInjector';

  private collectedWrapperIds: Array<{ fingerprint: string; id: string; messageId: string }> = [];

  constructor(
    private config: AgentDocumentChangesInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected buildContentForMessage(
    message: Message,
  ): { content: string; contextType: string } | null {
    if (this.config.enabled === false || !message.id) return null;

    const changes = this.config.changes?.[message.id];
    if (!changes || changes.length === 0) return null;

    log('Attaching %d agent-document changes to message %s', changes.length, message.id);

    // M2: pure derivation from the immutable, persisted change-note source.
    // Byte-identical for the same source; reflects a genuinely new note at once.
    const formatted = formatAgentDocumentChanges(changes);

    // P2: deterministic identity derived ONLY from the source (no wall clock,
    // no random). Recomputed on every operation — never cached — so it can
    // never mask a real change. Recorded in pipeline metadata for auditing;
    // this is not a UI write and not a session store.
    const fingerprint = Md5.hashStr(JSON.stringify({ changes, messageId: message.id }));
    this.collectedWrapperIds.push({
      fingerprint,
      id: wrapperBlockId('agentDocChanges', message.id, fingerprint),
      messageId: message.id,
    });

    return { content: formatted, contextType: 'agent_documents_changes' };
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    this.collectedWrapperIds = [];
    const result = await super.doProcess(context);
    result.metadata.agentDocChangesWrapperIds = this.collectedWrapperIds;
    return result;
  }
}
