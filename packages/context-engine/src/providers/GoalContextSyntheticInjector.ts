import { buildGoalOverviewPrompt } from '@lobechat/prompts';
import type { InitialGoalOverviewContext } from '@lobechat/types';
import debug from 'debug';
import { Md5 } from 'ts-md5';

import { BaseProcessor } from '../base/BaseProcessor';
import {
  type InjectionSnapshotStore,
  tailGoalContextKey,
} from '../injection/InjectionSnapshotStore';
import type { Message, PipelineContext, ProcessorOptions } from '../types';

const log = debug('context-engine:provider:GoalContextSyntheticInjector');

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    /** T-204 P2: deterministic synthetic tool-pair identity (no Date.now()/random). */
    goalContextInjectionIds?: { toolCallId: string; assistantId: string; toolId: string };
  }
}

export interface GoalContextToolPairSnapshot {
  assistantId: string;
  content: string;
  fingerprint: string;
  toolCallId: string;
  toolId: string;
}

export interface GoalContextSyntheticInjectorConfig {
  enabled?: boolean;
  /**
   * Structured snapshot of the viewed goal — the injector owns rendering it
   * into the synthetic `getGoalContext` result body, so transports only ship
   * data and prompt wording stays in one place.
   */
  overview?: InitialGoalOverviewContext;
  /** T-204 批D M1: session-scoped snapshot store for the synthetic tool pair. */
  snapshotStore?: InjectionSnapshotStore;
  topicId?: string;
}

/**
 * Goal Context Synthetic Injector
 *
 * Injects a fake assistant(tool_call getGoalContext) + tool(result) pair after
 * the last user message, carrying the goal-page overview as environment
 * information (same topology as {@link OnboardingSyntheticStateInjector}).
 *
 * Why a tool pair rather than appending to the user message: environment state
 * the product injects is not something the user said. As a tool result it is
 * clearly machine-provided, survives user-message rendering untouched, and
 * keeps the action→feedback shape models already handle for tool output.
 */
export class GoalContextSyntheticInjector extends BaseProcessor {
  readonly name = 'GoalContextSyntheticInjector';

  constructor(
    private config: GoalContextSyntheticInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    if (!this.config.enabled || !this.config.overview) {
      log('Disabled or no overview, skipping');
      return this.markAsExecuted(context);
    }

    const clonedContext = this.cloneContext(context);

    let lastUserIdx = -1;
    for (let i = clonedContext.messages.length - 1; i >= 0; i--) {
      if (clonedContext.messages[i].role === 'user') {
        lastUserIdx = i;
        break;
      }
    }

    if (lastUserIdx === -1) {
      log('No user message found, skipping');
      return this.markAsExecuted(context);
    }

    const toolContent = buildGoalOverviewPrompt(this.config.overview);

    // ---- T-204 M1 snapshot: identity + content are derived from the current
    // source fingerprint (no Date.now()) and stored in
    // `topicId:tail:goalContext`. While the source fingerprint matches we reuse
    // the stored bytes; when the runtime goal state changes we refresh the
    // snapshot so later operations never see stale goal context. ----
    const sourceFingerprint = Md5.hashStr(toolContent);
    const { snapshotStore, topicId } = this.config;
    let pair: GoalContextToolPairSnapshot;
    if (snapshotStore && topicId) {
      const key = tailGoalContextKey(topicId);
      pair =
        snapshotStore.getIfFresh<GoalContextToolPairSnapshot>(key, sourceFingerprint) ??
        snapshotStore.refresh(key, {
          assistantId: `synthetic-assistant-goal:${sourceFingerprint}`,
          content: toolContent,
          fingerprint: sourceFingerprint,
          toolCallId: `synthetic-getGoalContext:${sourceFingerprint}`,
          toolId: `synthetic-tool-goal:${sourceFingerprint}`,
        });
    } else {
      // Legacy path: keep the pre-change identity *shape* when no store is
      // supplied, but derive the fingerprint from the source text so ids stay
      // clock-free (P2) for standalone callers/tests as well.
      pair = {
        assistantId: `synthetic-assistant-goal-${sourceFingerprint}`,
        content: toolContent,
        fingerprint: sourceFingerprint,
        toolCallId: `synthetic-getGoalContext-${sourceFingerprint}`,
        toolId: `synthetic-tool-goal-${sourceFingerprint}`,
      };
    }

    const assistantMsg: Message = {
      content: '',
      id: pair.assistantId,
      role: 'assistant',
      tool_calls: [
        {
          function: {
            arguments: '{}',
            name: 'getGoalContext',
          },
          id: pair.toolCallId,
          type: 'function',
        },
      ],
    };

    const toolMsg: Message = {
      content: pair.content,
      id: pair.toolId,
      role: 'tool',
      tool_call_id: pair.toolCallId,
    };

    clonedContext.messages.splice(lastUserIdx + 1, 0, assistantMsg, toolMsg);
    clonedContext.metadata.goalContextInjectionIds = {
      assistantId: pair.assistantId,
      toolCallId: pair.toolCallId,
      toolId: pair.toolId,
    };

    log('Injected synthetic getGoalContext pair after user message %d', lastUserIdx);
    return this.markAsExecuted(clonedContext);
  }
}
