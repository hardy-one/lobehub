import { describe, expect, it } from 'vitest';

import { InjectionSnapshotStore } from '../../injection/InjectionSnapshotStore';
import type { PipelineContext } from '../../types';
import { OnboardingSyntheticStateInjector } from '../OnboardingSyntheticStateInjector';

const createContext = (): PipelineContext => ({
  initialState: { messages: [] },
  isAborted: false,
  messages: [
    { content: 'sys', role: 'system' },
    { content: 'hi', role: 'user' },
  ],
  metadata: {},
});

const inject = (store: InjectionSnapshotStore, phaseGuidance: string) =>
  new OnboardingSyntheticStateInjector({
    enabled: true,
    onboardingContext: { phaseGuidance },
    snapshotStore: store,
    topicId: 'tpc_onboarding_state_refresh',
  }).process(createContext());

const toolContent = (result: PipelineContext) =>
  String(result.messages.find((message) => message.role === 'tool')?.content);

describe('OnboardingSyntheticStateInjector', () => {
  it('injects the current onboarding state after it changes between operations', async () => {
    const store = new InjectionSnapshotStore();

    const first = await inject(store, 'STATE A');
    const second = await inject(store, 'STATE B — CHANGED');

    expect(toolContent(first)).toContain('STATE A');

    const current = toolContent(second);
    expect(current).toContain('STATE B — CHANGED');
    expect(current).not.toContain('STATE A');
    expect(second.metadata.onboardingStateInjectionIds?.toolCallId).not.toBe(
      first.metadata.onboardingStateInjectionIds?.toolCallId,
    );
  });
});
