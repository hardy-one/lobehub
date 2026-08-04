import { describe, expect, it } from 'vitest';

import { buildStoredContext, readStoredContext, signAgentConfig } from '../contextBudget';

describe('contextBudget (stored context tokens)', () => {
  const signature = signAgentConfig({ systemRole: 'r', plugins: ['a'] });
  const stored = {
    lastMsgId: 'msg-9',
    signature,
    tokens: 42_000,
  };

  describe('signAgentConfig', () => {
    it('is stable for the same config', () => {
      const cfg = { systemRole: 'role', plugins: ['tool-1'] };
      expect(signAgentConfig(cfg)).toBe(signAgentConfig(cfg));
    });

    it('changes when config changes', () => {
      expect(signAgentConfig({ systemRole: 'role', plugins: ['tool-1'] })).not.toBe(
        signAgentConfig({ systemRole: 'role', plugins: ['tool-1', 'tool-2'] }),
      );
      expect(signAgentConfig({ systemRole: 'role' })).not.toBe(
        signAgentConfig({ systemRole: 'other' }),
      );
    });

    it('handles undefined deterministically', () => {
      expect(signAgentConfig(undefined)).toBe(signAgentConfig(undefined));
    });
  });

  describe('readStoredContext', () => {
    it('returns undefined when no stored context exists', () => {
      expect(readStoredContext(undefined)).toBeUndefined();
      expect(readStoredContext({})).toBeUndefined();
      expect(readStoredContext({ contextTokens: undefined })).toBeUndefined();
    });

    it('returns tokens + lastMsgId when a valid entry exists', () => {
      expect(readStoredContext({ contextTokens: stored }, signature)).toEqual({
        lastMsgId: 'msg-9',
        tokens: 42_000,
      });
    });

    it('returns undefined when the agent config signature differs (config changed)', () => {
      expect(
        readStoredContext({ contextTokens: stored }, signAgentConfig({ systemRole: 'other' })),
      ).toBeUndefined();
    });

    it('skips the signature check when no current signature is provided', () => {
      expect(readStoredContext({ contextTokens: stored })).toEqual({
        lastMsgId: 'msg-9',
        tokens: 42_000,
      });
    });

    it('returns undefined when stored tokens are not positive', () => {
      expect(readStoredContext({ contextTokens: { ...stored, tokens: 0 } })).toBeUndefined();
    });

    it('returns undefined when tokens exceed the sanity ceiling (forged value)', () => {
      expect(
        readStoredContext({ contextTokens: { ...stored, tokens: 1e15 } }, signature),
      ).toBeUndefined();
    });

    it('returns undefined when lastMsgId is missing', () => {
      expect(
        readStoredContext({ contextTokens: { tokens: 100, lastMsgId: '', signature } }),
      ).toBeUndefined();
    });
  });

  describe('buildStoredContext', () => {
    it('builds a stored-context entry from usage', () => {
      expect(buildStoredContext({ totalTokens: 12_345 }, 'msg-10', signature)).toEqual({
        lastMsgId: 'msg-10',
        signature,
        tokens: 12_345,
      });
    });

    it('returns undefined when usage.totalTokens is missing or zero', () => {
      expect(buildStoredContext({}, 'msg-10', signature)).toBeUndefined();
      expect(buildStoredContext({ totalTokens: 0 }, 'msg-10', signature)).toBeUndefined();
    });

    it('returns undefined when lastMsgId is missing', () => {
      expect(buildStoredContext({ totalTokens: 100 }, '', signature)).toBeUndefined();
    });
  });
});
