import { DEFAULT_PROVIDER } from '@lobechat/business-const';
import type { LobeAgentAgencyConfig } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_SUB_AGENT_MODEL,
  resolveSubAgentModel,
  resolveSubAgentModelWithCallOverrideDetailed,
} from './llm';

// A build that swaps `@lobechat/business-const` (the cloud one) serves a different
// provider whose catalog does not carry the self-hosted default model id.
vi.mock('@lobechat/business-const', () => ({
  DEFAULT_MINI_MODEL: 'swapped-mini-model',
  DEFAULT_MODEL: 'swapped-default-model',
  DEFAULT_PROVIDER: 'swapped-provider',
}));

type Subagent = LobeAgentAgencyConfig['subagent'];

const subagent = (value: { model?: string | null; provider?: string | null }): Subagent =>
  value as Subagent;

describe('resolveSubAgentModel', () => {
  it('falls back to the default model of the same business-const build as the provider', () => {
    expect(resolveSubAgentModel(undefined)).toEqual({
      model: 'swapped-default-model',
      provider: 'swapped-provider',
    });
  });
});

describe('resolveSubAgentModelWithCallOverrideDetailed', () => {
  it.each([
    [
      { model: 'call-model', provider: 'call-provider' },
      subagent({ model: 'subagent-model', provider: 'subagent-provider' }),
      { model: 'parent-model', provider: 'parent-provider' },
      'call-provider',
    ],
    [
      { model: 'call-model' },
      subagent({ model: 'subagent-model', provider: 'subagent-provider' }),
      { model: 'parent-model', provider: 'parent-provider' },
      'subagent-provider',
    ],
    [
      { model: 'call-model' },
      subagent({ model: 'subagent-model' }),
      { model: 'parent-model', provider: 'parent-provider' },
      'parent-provider',
    ],
    [{ model: 'call-model' }, undefined, undefined, DEFAULT_PROVIDER],
  ])('uses per-call model and provider fallback chain', (callOverride, agent, parent, provider) => {
    expect(resolveSubAgentModelWithCallOverrideDetailed(callOverride, agent, parent)).toEqual({
      model: 'call-model',
      provider,
      explicit: true,
    });
  });

  it('ignores a provider-only call override and preserves static resolution', () => {
    const config = subagent({ model: 'subagent-model', provider: 'subagent-provider' });
    const resolved = resolveSubAgentModel(config, {
      model: 'parent-model',
      provider: 'parent-provider',
    });

    expect(
      resolveSubAgentModelWithCallOverrideDetailed({ provider: 'call-provider' }, config, {
        model: 'parent-model',
        provider: 'parent-provider',
      }),
    ).toEqual({ ...resolved, explicit: true });
  });

  it.each([
    [subagent({ model: 'subagent-model', provider: 'subagent-provider' }), undefined, true],
    [subagent({ model: 'subagent-model' }), undefined, true],
    [subagent({ provider: 'subagent-provider' }), { model: 'parent-model' }, true],
    [undefined, { model: 'parent-model', provider: 'parent-provider' }, true],
    [undefined, { provider: 'parent-provider' }, false],
    [subagent({ model: '' }), { model: '' }, false],
    [undefined, undefined, false],
  ])('matches existing static resolver and explicit status', (agent, parent, explicit) => {
    expect(resolveSubAgentModelWithCallOverrideDetailed(undefined, agent, parent)).toEqual({
      ...resolveSubAgentModel(agent, parent),
      explicit,
    });
  });

  it('uses global defaults when configured model strings are empty', () => {
    expect(
      resolveSubAgentModelWithCallOverrideDetailed({ model: '' }, subagent({ model: '' }), {
        model: '',
      }),
    ).toEqual({ model: DEFAULT_SUB_AGENT_MODEL, provider: DEFAULT_PROVIDER, explicit: false });
  });
});
