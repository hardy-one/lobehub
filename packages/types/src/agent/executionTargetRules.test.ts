import type * as BusinessConst from '@lobechat/business-const';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ExecutionPlan } from './agencyConfig';
import { AgentChatConfigSchema } from './chatConfig';
import { resolveContextMode, resolveToolMode } from './executionTargetRules';

const offlineBoundDevice = {
  kind: 'device-unrouted',
  reason: 'bound-device-offline',
  target: 'device',
} as unknown as ExecutionPlan;

const loadDescribe = async (branding?: Partial<typeof BusinessConst>) => {
  vi.resetModules();
  if (branding) {
    vi.doMock('@lobechat/business-const', async (importOriginal) => ({
      ...(await importOriginal<typeof BusinessConst>()),
      ...branding,
    }));
    // Under vitest 5 a `doMock` only lands once the test file itself imports
    // something, so pull the mocked module in before the one under test.
    await import('@lobechat/business-const');
  }
  return (await import('./executionTargetRules')).describeLockedDevicePicker;
};

afterEach(() => {
  vi.doUnmock('@lobechat/business-const');
  vi.resetModules();
});

describe('describeLockedDevicePicker', () => {
  it('points at the upstream desktop app under default branding', async () => {
    const describeLockedDevicePicker = await loadDescribe();

    expect(describeLockedDevicePicker(offlineBoundDevice)).toContain(
      'Tell the user to reconnect it (LobeHub desktop app or `lh connect`).',
    );
  });

  it("points at the deployment's own desktop app under custom branding", async () => {
    const describeLockedDevicePicker = await loadDescribe({ BRANDING_NAME: 'Acme' });
    const hint = describeLockedDevicePicker(offlineBoundDevice);

    expect(hint).toContain('Tell the user to reconnect it (Acme desktop app or `lh connect`).');
    expect(hint).not.toContain('LobeHub');
  });

  it('tells the model to retry while a managed device starts', async () => {
    const describeLockedDevicePicker = await loadDescribe();
    const hint = describeLockedDevicePicker({
      deviceId: 'managed-a',
      kind: 'device-wakeable',
      target: 'device',
    });

    expect(hint).toContain('managed cloud device "managed-a", which is starting');
    expect(hint).toContain('DEVICE_WAKING');
  });
});

describe('resolveToolMode', () => {
  it.each([
    [undefined, 'agent'],
    [{}, 'agent'],
    [{ enableAgentMode: true }, 'agent'],
    [{ enableAgentMode: false }, 'chat'],
    [{ enableAgentMode: true, toolMode: 'chat' }, 'chat'],
    [{ enableAgentMode: false, toolMode: 'agent' }, 'agent'],
    [{ enableAgentMode: true, toolMode: 'custom' }, 'custom'],
  ] as const)('preserves the existing tri-state for %j', (chatConfig, expected) => {
    expect(resolveToolMode(chatConfig)).toBe(expected);
  });
});

describe('resolveContextMode', () => {
  it('defaults omitted or explicit default configs to default', () => {
    expect(resolveContextMode(undefined, { supportToolUse: true })).toBe('default');
    expect(resolveContextMode({}, { supportToolUse: true })).toBe('default');
    expect(
      resolveContextMode(
        { contextMode: 'default', enableAgentMode: true },
        { supportToolUse: true },
      ),
    ).toBe('default');
  });

  it('enables on-demand only for explicit on-demand + agent + function calling', () => {
    expect(
      resolveContextMode(
        { contextMode: 'on-demand', enableAgentMode: true, toolMode: 'agent' },
        { supportToolUse: true },
      ),
    ).toBe('on-demand');
  });

  it.each([
    [{ contextMode: 'on-demand' as const, enableAgentMode: false }, true],
    [{ contextMode: 'on-demand' as const, enableAgentMode: true, toolMode: 'chat' as const }, true],
    [
      {
        contextMode: 'on-demand' as const,
        enableAgentMode: true,
        toolMode: 'custom' as const,
      },
      true,
    ],
    [{ contextMode: 'on-demand' as const, enableAgentMode: true }, false],
  ] as const)('falls back for unsafe combination %j (support=%s)', (chatConfig, supportToolUse) => {
    expect(resolveContextMode(chatConfig, { supportToolUse })).toBe('default');
  });

  it('never lets contextMode change the legacy tool mode', () => {
    const chatConfig = {
      contextMode: 'on-demand' as const,
      enableAgentMode: false,
      toolMode: 'agent' as const,
    };

    expect(resolveToolMode(chatConfig)).toBe('agent');
    expect(resolveContextMode(chatConfig, { supportToolUse: true })).toBe('on-demand');
  });
});

describe('AgentChatConfigSchema contextMode', () => {
  it('accepts the new option and leaves it absent by default', () => {
    expect(AgentChatConfigSchema.parse({})).not.toHaveProperty('contextMode');
    expect(AgentChatConfigSchema.parse({ contextMode: 'default' }).contextMode).toBe('default');
    expect(AgentChatConfigSchema.parse({ contextMode: 'on-demand' }).contextMode).toBe('on-demand');
  });

  it('rejects unknown context modes', () => {
    expect(() => AgentChatConfigSchema.parse({ contextMode: 'efficient' })).toThrow();
  });
});
