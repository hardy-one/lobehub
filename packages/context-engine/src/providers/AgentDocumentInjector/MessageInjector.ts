import debug from 'debug';
import { Md5 } from 'ts-md5';

import { BaseProcessor } from '../../base/BaseProcessor';
import {
  type AgentDocMessageIndexEntry,
  agentDocMessageIndexKey,
  agentDocMessageKey,
  type InjectionSnapshotStore,
} from '../../injection/InjectionSnapshotStore';
import type { PipelineContext, ProcessorOptions } from '../../types';
import type { AgentContextDocument, AgentDocumentFilterContext } from './shared';
import { combineDocuments, getDocumentsForPositions, withRunStartedAt } from './shared';

const log = debug('context-engine:provider:AgentDocumentMessageInjector');

declare module '../../types' {
  interface PipelineContextMetadataOverrides {
    /**
     * T-219 P2: source-derived carrier identity of the two injected
     * `role:'system'` messages, recorded before `MessageCleanup` strips
     * `id`/`createdAt` from the payload.
     */
    agentDocumentMessageInjectionIds?: Record<string, string>;
  }
}

export interface AgentDocumentMessageSnapshot {
  /** Solidified bytes reused while the source fingerprint is unchanged. */
  content: string;
  /** Source-derived timestamp, replayed together with the bytes. */
  createdAt: number;
  /** `Md5(content)` — a changed source re-projects instead of freezing (T-200). */
  fingerprint: string;
}

export interface AgentDocumentMessageInjectorConfig extends AgentDocumentFilterContext {
  documents?: AgentContextDocument[];
  enabled?: boolean;
  /**
   * T-219 M1: session-scoped snapshot store. When present together with
   * `topicId`, the injected carrier identity is derived from `docId + position`
   * (no `Date.now()`) and the content is solidified under
   * `<topicId>:agentDoc:message:<docKey>:<position>`.
   */
  snapshotStore?: InjectionSnapshotStore;
  topicId?: string;
}

/** Source-derived timestamp: never wall-clock time (T-193 P2). */
const toEpoch = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
};

/**
 * Stable identity of the documents behind one injected carrier. Documents are
 * merged into a single message per position, so the source id is the sorted set
 * of contributing document ids (falling back to the filename) — never a clock.
 */
const documentKey = (docs: AgentContextDocument[]): string =>
  Md5.hashStr(
    docs
      .map((doc) => doc.id ?? doc.filename)
      .sort()
      .join('|'),
  );

/** Newest `updatedAt`/`createdAt` among the contributing documents, in epoch ms. */
const sourceTimestamp = (docs: AgentContextDocument[]): number =>
  docs.reduce((max, doc) => Math.max(max, toEpoch(doc.updatedAt ?? doc.createdAt)), 0);

/**
 * A synthetic injection carrier must never act as the "first real user" anchor.
 *
 * `BaseFirstUserContentProvider` inserts its merged block as `role:'user'` with
 * `meta.systemInjection = true`; virtual-tail carriers carry `meta.virtualLastUser`,
 * and user steer messages carry `meta.steer`. Anchoring on the first `role:'user'`
 * message would let those sibling injections displace this document *before* the
 * real user turn, i.e. a floating position instead of a fixed one (T-219 review).
 */
const isInjectionCarrier = (message: { meta?: Record<string, unknown>; role: string }): boolean => {
  const meta = message.meta;
  if (!meta) return false;
  return (
    meta.systemInjection === true ||
    meta.virtualLastUser === true ||
    meta.injectContext === true ||
    meta.steer !== undefined ||
    meta.injectType !== undefined
  );
};

/**
 * Injects agent documents at specific message positions.
 * Handles `after-first-user` and `context-end` positions.
 *
 * Placed in Phase 4 (User Message Augmentation).
 *
 * T-219: the two carriers keep their `role:'system'` shape and their positions —
 * `position` alone decides the slot (first real user index + 1 / sequence end).
 * Only the identity (`id`/`createdAt`) and the persistence source changed: with a
 * session store supplied the carrier id is derived from `docId + position` and
 * the content is solidified in `<topicId>:agentDoc:message:<docKey>:<position>`.
 * Trigger conditions and the injection text template are untouched (P5).
 */
export class AgentDocumentMessageInjector extends BaseProcessor {
  readonly name = 'AgentDocumentMessageInjector';

  constructor(
    private config: AgentDocumentMessageInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  /**
   * Carrier identity for one injected message.
   *
   * M1 path: id from the source document set + position, createdAt from the
   * documents' own timestamps, and the rendered content solidified per session
   * key. A fingerprint mismatch means the documents really changed, so the
   * snapshot is re-projected rather than frozen (T-200 hazard).
   *
   * No wall-clock identity exists on any path: without a store the content is
   * simply not solidified, and the id/timestamp stay source-derived.
   */
  private carrierIdentity(
    position: 'after-first-user' | 'context-end',
    docs: AgentContextDocument[],
    content: string,
  ): { createdAt: number; id: string } {
    const { snapshotStore, topicId } = this.config;
    const docKey = documentKey(docs);

    const createdAt = sourceTimestamp(docs);

    if (snapshotStore && topicId) {
      const key = agentDocMessageKey(topicId, docKey, position);
      const fingerprint = Md5.hashStr(content);
      const stored = snapshotStore.get<AgentDocumentMessageSnapshot>(key);

      // Matching fingerprint → the already solidified bytes are what we project
      // (byte-identical by construction). Mismatch → the source changed, so the
      // snapshot is refreshed instead of freezing stale document content.
      if (!stored || stored.fingerprint !== fingerprint) {
        snapshotStore.set(key, { content, createdAt, fingerprint });
      }

      // Persist-once (same M1 rule as the other points in this batch): record
      // which carrier this fixed slot holds, so a later operation that no longer
      // selects the documents still projects the same bytes at the same slot.
      const indexKey = agentDocMessageIndexKey(topicId);
      const index = snapshotStore.get<Record<string, AgentDocMessageIndexEntry>>(indexKey) || {};
      if (index[position]?.docKey !== docKey) {
        snapshotStore.set(indexKey, { ...index, [position]: { createdAt, docKey } });
      }
    }

    return {
      createdAt,
      id: `inject:agentDoc:message:${docKey}:${position}`,
    };
  }

  /**
   * Carrier solidified earlier in this session for `position`, if any. Used when
   * the current operation no longer selects documents for that slot: the block
   * keeps its fixed position instead of flickering out of the prompt.
   */
  private persistedCarrier(
    position: 'after-first-user' | 'context-end',
  ): { content: string; createdAt: number; id: string } | null {
    const { snapshotStore, topicId } = this.config;
    if (!snapshotStore || !topicId) return null;

    const entry = snapshotStore.get<Record<string, AgentDocMessageIndexEntry>>(
      agentDocMessageIndexKey(topicId),
    )?.[position];
    if (!entry) return null;

    const snapshot = snapshotStore.get<AgentDocumentMessageSnapshot>(
      agentDocMessageKey(topicId, entry.docKey, position),
    );
    if (!snapshot) return null;

    return {
      content: snapshot.content,
      createdAt: snapshot.createdAt ?? entry.createdAt,
      id: `inject:agentDoc:message:${entry.docKey}:${position}`,
    };
  }

  /** First real user turn: the first `role:'user'` message that is not a synthetic injection carrier. */
  private findFirstRealUserIndex(
    messages: { meta?: Record<string, unknown>; role: string }[],
  ): number {
    return messages.findIndex((message) => message.role === 'user' && !isInjectionCarrier(message));
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    if (this.config.enabled === false) return this.markAsExecuted(context);

    const allDocs = this.config.documents || [];
    if (allDocs.length === 0) return this.markAsExecuted(context);

    const afterFirstUserDocs = getDocumentsForPositions(allDocs, ['after-first-user'], this.config);
    const contextEndDocs = getDocumentsForPositions(allDocs, ['context-end'], this.config);

    // T-219 M1 persist-once: a carrier already solidified in this session keeps
    // its fixed slot even when this operation selects no documents for it.
    const persistedAfterFirstUser =
      afterFirstUserDocs.length === 0 ? this.persistedCarrier('after-first-user') : null;
    const persistedContextEnd =
      contextEndDocs.length === 0 ? this.persistedCarrier('context-end') : null;

    if (
      afterFirstUserDocs.length === 0 &&
      contextEndDocs.length === 0 &&
      !persistedAfterFirstUser &&
      !persistedContextEnd
    ) {
      return this.markAsExecuted(context);
    }

    const clonedContext = this.cloneContext(context);

    // Inject after first user message
    if (afterFirstUserDocs.length > 0) {
      const firstUserIndex = this.findFirstRealUserIndex(clonedContext.messages);
      if (firstUserIndex !== -1) {
        const content = combineDocuments(
          afterFirstUserDocs,
          withRunStartedAt(this.config, clonedContext.messages),
        );
        const identity = this.carrierIdentity('after-first-user', afterFirstUserDocs, content);
        clonedContext.messages.splice(firstUserIndex + 1, 0, {
          content,
          createdAt: identity.createdAt,
          id: identity.id,
          role: 'system' as const,
          updatedAt: identity.createdAt,
        } as any);
        clonedContext.metadata.agentDocumentMessageInjectionIds = {
          ...clonedContext.metadata.agentDocumentMessageInjectionIds,
          'after-first-user': identity.id,
        };
        log('Injected %d agent documents after first user message', afterFirstUserDocs.length);
      }
    } else if (persistedAfterFirstUser) {
      // Replay the solidified carrier at the same fixed slot (M1 persist-once).
      const firstUserIndex = this.findFirstRealUserIndex(clonedContext.messages);
      if (firstUserIndex !== -1) {
        clonedContext.messages.splice(firstUserIndex + 1, 0, {
          content: persistedAfterFirstUser.content,
          createdAt: persistedAfterFirstUser.createdAt,
          id: persistedAfterFirstUser.id,
          role: 'system' as const,
          updatedAt: persistedAfterFirstUser.createdAt,
        } as any);
        clonedContext.metadata.agentDocumentMessageInjectionIds = {
          ...clonedContext.metadata.agentDocumentMessageInjectionIds,
          'after-first-user': persistedAfterFirstUser.id,
        };
        log('Replayed solidified agent documents after first user message');
      }
    }

    // Inject at context end
    if (contextEndDocs.length > 0) {
      const content = combineDocuments(
        contextEndDocs,
        withRunStartedAt(this.config, clonedContext.messages),
      );
      const identity = this.carrierIdentity('context-end', contextEndDocs, content);
      clonedContext.messages.push({
        content,
        createdAt: identity.createdAt,
        id: identity.id,
        role: 'system' as const,
        updatedAt: identity.createdAt,
      } as any);
      clonedContext.metadata.agentDocumentMessageInjectionIds = {
        ...clonedContext.metadata.agentDocumentMessageInjectionIds,
        'context-end': identity.id,
      };
      log('Injected %d agent documents at context end', contextEndDocs.length);
    } else if (persistedContextEnd) {
      // Replay the solidified carrier at the sequence end (M1 persist-once).
      clonedContext.messages.push({
        content: persistedContextEnd.content,
        createdAt: persistedContextEnd.createdAt,
        id: persistedContextEnd.id,
        role: 'system' as const,
        updatedAt: persistedContextEnd.createdAt,
      } as any);
      clonedContext.metadata.agentDocumentMessageInjectionIds = {
        ...clonedContext.metadata.agentDocumentMessageInjectionIds,
        'context-end': persistedContextEnd.id,
      };
      log('Replayed solidified agent documents at context end');
    }

    return this.markAsExecuted(clonedContext);
  }
}
