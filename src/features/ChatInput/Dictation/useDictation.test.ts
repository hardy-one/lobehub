import { describe, expect, it, vi } from 'vitest';

import { RealtimeDictationError } from './contract';
import { probeRealtimeAdmission, shouldFallbackToOneshot } from './useDictation';

describe('shouldFallbackToOneshot', () => {
  // One-shot goes through the tRPC `asr.transcribe` endpoint, so anything meaning "the
  // realtime transport is unusable" can still be served by one-shot.
  it.each([
    'NETWORK_DISCONNECTED',
    'PROTOCOL_ERROR',
    'PROVIDER_NOT_CONFIGURED',
    'PROVIDER_UNAVAILABLE',
    'SESSION_CREATE_FAILED',
  ] as const)('falls back for %s', (code) => {
    expect(shouldFallbackToOneshot(new RealtimeDictationError(code, false))).toBe(true);
  });

  // These reflect account-level conditions that would fail one-shot just as well.
  it.each(['AUTH_FAILED', 'PROVIDER_BILLING_BLOCKED', 'SESSION_LIMIT_EXCEEDED'] as const)(
    'keeps realtime for %s',
    (code) => {
      expect(shouldFallbackToOneshot(new RealtimeDictationError(code, false))).toBe(false);
    },
  );

  it('ignores values that are not dictation errors', () => {
    expect(shouldFallbackToOneshot(new Error('boom'))).toBe(false);
    expect(shouldFallbackToOneshot(undefined)).toBe(false);
  });
});

describe('probeRealtimeAdmission', () => {
  it('reuses the session it created', async () => {
    const session = { sessionId: 's', token: 't', websocketUrl: 'wss://example.test/ws' };

    await expect(
      probeRealtimeAdmission(async () => session, new AbortController().signal),
    ).resolves.toEqual({ fallback: false, probed: true, session });
  });

  it('requests a fallback when the endpoint is missing', async () => {
    const createSession = vi
      .fn()
      .mockRejectedValue(new RealtimeDictationError('PROVIDER_NOT_CONFIGURED', false));

    await expect(
      probeRealtimeAdmission(createSession, new AbortController().signal),
    ).resolves.toEqual({ fallback: true, probed: true });
  });

  it('keeps realtime when the failure is account-level', async () => {
    const createSession = vi
      .fn()
      .mockRejectedValue(new RealtimeDictationError('AUTH_FAILED', false));

    await expect(
      probeRealtimeAdmission(createSession, new AbortController().signal),
    ).resolves.toEqual({ fallback: false, probed: true });
  });
});
