import type { ExpertisePromptDomain, ExpertisePromptLesson } from '@lobechat/prompts';
import { promptExpertise } from '@lobechat/prompts';
import type { ExpertiseContextSnapshot } from '@lobechat/types';
import { EXPERTISE_CONTEXT_SCHEMA_VERSION } from '@lobechat/types';
import { Md5 } from 'ts-md5';

import { BaseFirstUserContentProvider } from '../base/BaseFirstUserContentProvider';
import type { InjectionSnapshotStore } from '../injection/InjectionSnapshotStore';
import { firstUserExpertiseKey } from '../injection/InjectionSnapshotStore';
import type { Message, PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    expertiseContentHash?: string;
    expertiseDomainCount?: number;
    expertiseInjectionCreatedAt?: number;
    /** Deterministic carrier identity, recorded so it survives MessageCleanup (P2 probe). */
    expertiseInjectionId?: string;
    expertiseLessonCount?: number;
  }
}

export interface ExpertiseContextInjectorConfig {
  enabled?: boolean;
  expertise?: ExpertiseContextSnapshot;
  /**
   * T-193 §1.3 M1: session-scoped injection snapshot store. When supplied, the
   * first matching request writes `topicId:firstUser:expertise` and every later
   * operation reuses that exact snapshot instead of re-collecting.
   */
  snapshotStore?: InjectionSnapshotStore;
  topicId?: string;
}

interface ExpertiseContextDomain extends ExpertisePromptDomain {
  id: string;
}

interface ExpertiseContextLesson extends ExpertisePromptLesson {
  id: string;
}

export interface ExpertiseContextSource {
  listDomainsForAgent: (
    agentId: string,
  ) => Promise<Array<{ domain: Omit<ExpertiseContextDomain, 'lessons'> }>>;
  listLessons: (domainId: string) => Promise<ExpertiseContextLesson[]>;
}

export const buildExpertiseContextSnapshot = async (
  source: ExpertiseContextSource,
  agentId: string,
): Promise<ExpertiseContextSnapshot | undefined> => {
  const bindings = await source.listDomainsForAgent(agentId);
  if (bindings.length === 0) return undefined;

  const domains = await Promise.all(
    bindings.map(async ({ domain }) => ({
      ...domain,
      lessons: await source.listLessons(domain.id),
    })),
  );
  const renderedContext = promptExpertise(domains);

  return {
    contentHash: Md5.hashStr(renderedContext),
    domains: domains.map((domain) => ({
      id: domain.id,
      lessonIds: domain.lessons.map(({ id }) => id),
    })),
    renderedContext,
    schemaVersion: EXPERTISE_CONTEXT_SCHEMA_VERSION,
  };
};

const toEpoch = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const t = Date.parse(value);
    if (Number.isFinite(t)) return t;
  }
  return 0;
};

export class ExpertiseContextInjector extends BaseFirstUserContentProvider {
  readonly name = 'ExpertiseContextInjector';

  /** createdAt of the first real user turn — deterministic carrier identity (P2). */
  private carrierCreatedAt = 0;

  constructor(
    private config: ExpertiseContextInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  /** Trigger condition and injection template are byte-for-byte unchanged. */
  protected buildContent(): null | string {
    if (!this.config.enabled) return null;
    return this.config.expertise?.renderedContext || null;
  }

  /**
   * M1 session snapshot solidification. The trigger expressions below are the
   * originals verbatim; only the identity and the *source* of the already-
   * collected value change — the expression and the injected template stay
   * byte-identical (T-193 P5).
   */
  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const { snapshotStore, topicId } = this.config;

    if (snapshotStore && topicId) {
      // Deterministic carrier timestamp from the first real user turn, never now().
      const firstUser = context.messages.find((msg) => msg.role === 'user');
      this.carrierCreatedAt = toEpoch(firstUser?.createdAt);

      // Original trigger expression, verbatim.
      if (this.config.enabled && this.config.expertise?.renderedContext) {
        const key = firstUserExpertiseKey(topicId);
        const stored = snapshotStore.get<ExpertiseContextSnapshot>(key);
        if (stored) {
          // Cross-operation reuse: read the same key, reuse the exact bytes.
          this.config = { ...this.config, expertise: stored };
        } else {
          // First matching request: collect once, write to the session store.
          snapshotStore.set(key, this.config.expertise);
        }
      }
    }

    // Original trigger expression + original template unchanged (P5).
    const result = await super.doProcess(context);

    // Record the deterministic carrier id (source-derived, no wall-clock or random)
    // in pipeline metadata so P2 remains provable after MessageCleanup strips meta.
    const carrier = result.messages.find((msg) => msg.meta?.systemInjection === true);
    if (carrier) {
      result.metadata.expertiseInjectionId = carrier.id;
      result.metadata.expertiseInjectionCreatedAt = carrier.createdAt;
    }

    // Original metadata bookkeeping, verbatim.
    const snapshot = this.config.expertise;
    if (!this.config.enabled || !snapshot?.renderedContext) return result;

    result.metadata.expertiseContentHash = snapshot.contentHash;
    result.metadata.expertiseDomainCount = snapshot.domains.length;
    result.metadata.expertiseLessonCount = snapshot.domains.reduce(
      (total, domain) => total + domain.lessonIds.length,
      0,
    );
    return result;
  }

  /**
   * P2: deterministic carrier identity derived from the snapshot content hash
   * and the first real user's createdAt — no wall-clock time, no random id
   * anywhere in this injection path. The injected CONTENT text and role/meta are exactly
   * the base template's; only id/createdAt/updatedAt are source-derived, which
   * T-193 §1.4 P5 explicitly exempts ("仅 id/createdAt/落点可变").
   */
  protected createSystemInjectionMessage(content: string): Message {
    const contentHash = this.config.expertise?.contentHash ?? Md5.hashStr(content);
    return {
      content,
      createdAt: this.carrierCreatedAt,
      id: `inject:firstUser:expertise:${contentHash}`,
      meta: { systemInjection: true },
      role: 'user' as const,
      updatedAt: this.carrierCreatedAt,
    };
  }
}
