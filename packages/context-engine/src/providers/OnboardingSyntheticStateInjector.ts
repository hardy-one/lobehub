import debug from 'debug';
import { Md5 } from 'ts-md5';

import { BaseProcessor } from '../base/BaseProcessor';
import {
  type InjectionSnapshotStore,
  tailOnboardingStateKey,
} from '../injection/InjectionSnapshotStore';
import type { Message, PipelineContext, ProcessorOptions } from '../types';
import type {
  OnboardingContextInjectorConfig,
  OnboardingUserInfo,
} from './OnboardingContextInjector';
import { formatOnboardingUserInfo } from './OnboardingContextInjector';

const log = debug('context-engine:provider:OnboardingSyntheticStateInjector');

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    /** T-204 P2: deterministic synthetic tool-pair identity (no Date.now()/random). */
    onboardingStateInjectionIds?: { toolCallId: string; assistantId: string; toolId: string };
  }
}

export interface OnboardingStateToolPairSnapshot {
  assistantId: string;
  content: string;
  fingerprint: string;
  toolCallId: string;
  toolId: string;
}

/**
 * Onboarding Synthetic State Injector
 *
 * Injects a fake assistant(tool_call) + tool(result) message pair after the
 * last user message to reproduce the V1 getOnboardingState topology.
 *
 * Why: In V1, getOnboardingState was called every turn. Its tool-role result
 * created an action→feedback→action chain that drove models to call subsequent
 * persistence tools. Simply injecting the same info as user-role content does
 * not trigger this chain. By faking the tool call pair, the model sees the
 * same message topology as V1 and resumes the action loop.
 */
export class OnboardingSyntheticStateInjector extends BaseProcessor {
  readonly name = 'OnboardingSyntheticStateInjector';

  constructor(
    private config: OnboardingContextInjectorConfig & {
      snapshotStore?: InjectionSnapshotStore;
      topicId?: string;
    },
    _options: ProcessorOptions = {},
  ) {
    super(_options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    if (!this.config.enabled || !this.config.onboardingContext?.phaseGuidance) {
      log('Disabled or no phaseGuidance, skipping');
      return this.markAsExecuted(context);
    }

    const ctx = this.config.onboardingContext;

    // Build the synthetic tool result content (mimics getOnboardingState response)
    let stateResult = this.buildStateResult(
      ctx.phaseGuidance,
      ctx.soulContent,
      ctx.personaContent,
      ctx.userInfo,
    );

    const clonedContext = this.cloneContext(context);

    // Find the last user message index
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

    // Insert the pair right after the last user message
    const insertIdx = lastUserIdx + 1;

    // ---- T-204 M1 snapshot: synthetic tool pair identity + content are derived
    // from the current source fingerprint (no Date.now()) and stored in
    // `topicId:tail:onboardingState`. Matching fingerprints reuse the stored
    // bytes; a changed onboarding state refreshes the snapshot so later
    // operations never see stale state. ----
    const sourceFingerprint = Md5.hashStr(stateResult);
    const { snapshotStore, topicId } = this.config;
    let pair: OnboardingStateToolPairSnapshot;
    if (snapshotStore && topicId) {
      const key = tailOnboardingStateKey(topicId);
      const stored = snapshotStore.getIfFresh<OnboardingStateToolPairSnapshot>(
        key,
        sourceFingerprint,
      );
      if (stored) {
        pair = stored;
        // P5: the projected tool-result body keeps the baseline template slot.
        stateResult = stored.content;
      } else {
        pair = snapshotStore.refresh(key, {
          assistantId: `synthetic-assistant:${sourceFingerprint}`,
          content: stateResult,
          fingerprint: sourceFingerprint,
          toolCallId: `synthetic-getOnboardingState:${sourceFingerprint}`,
          toolId: `synthetic-tool:${sourceFingerprint}`,
        });
      }
    } else {
      // No store supplied: same identity shape, but source-derived so the id
      // never depends on a wall clock (P2).
      pair = {
        assistantId: `synthetic-assistant-${sourceFingerprint}`,
        content: stateResult,
        fingerprint: sourceFingerprint,
        toolCallId: `synthetic-getOnboardingState-${sourceFingerprint}`,
        toolId: `synthetic-tool-${sourceFingerprint}`,
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
            name: 'lobe-web-onboarding____getOnboardingState',
          },
          id: pair.toolCallId,
          type: 'function',
        },
      ],
    };

    const toolMsg: Message = {
      content: stateResult,
      id: pair.toolId,
      role: 'tool',
      tool_call_id: pair.toolCallId,
    };

    clonedContext.messages.splice(insertIdx, 0, assistantMsg, toolMsg);
    clonedContext.metadata.onboardingStateInjectionIds = {
      assistantId: pair.assistantId,
      toolCallId: pair.toolCallId,
      toolId: pair.toolId,
    };

    log('Injected synthetic getOnboardingState pair at index %d', insertIdx);
    return this.markAsExecuted(clonedContext);
  }

  private buildStateResult(
    phaseGuidance: string,
    soulContent?: string | null,
    personaContent?: string | null,
    userInfo?: OnboardingUserInfo | null,
  ): string {
    const parts: string[] = [phaseGuidance];

    if (soulContent) {
      parts.push(`<current_soul_document>\n${soulContent}\n</current_soul_document>`);
    }
    if (personaContent) {
      parts.push(`<current_user_persona>\n${personaContent}\n</current_user_persona>`);
    }

    const formattedUserInfo = formatOnboardingUserInfo(userInfo);
    if (formattedUserInfo) {
      parts.push(formattedUserInfo);
    }

    return parts.join('\n\n');
  }
}
