import { beforeEach, describe, expect, it, vi } from 'vitest';

// Get mocked module
import { authEnv } from '@/envs/auth';

import {
  buildInvitationCodeCookie,
  INVITATION_CODE_COOKIE,
  isInvitationCodeRequired,
  isInvitationCodeValid,
  parseInvitationCodes,
  readInvitationCodeCookie,
} from './invitation-code';

vi.mock('@/envs/auth', () => ({
  authEnv: {
    AUTH_INVITATION_CODES: undefined as string | undefined,
  },
}));

const setCodes = (value?: string) => {
  (authEnv as { AUTH_INVITATION_CODES: string | undefined }).AUTH_INVITATION_CODES = value;
};

describe('invitationCode utils', () => {
  beforeEach(() => {
    setCodes(undefined);
  });

  describe('parseInvitationCodes', () => {
    it('should be empty when unset or blank', () => {
      expect(parseInvitationCodes(undefined)).toEqual([]);
      expect(parseInvitationCodes('   ')).toEqual([]);
    });

    it('should accept both half-width and full-width separators', () => {
      expect(parseInvitationCodes('CODE1,CODE2，CODE3')).toEqual(['CODE1', 'CODE2', 'CODE3']);
    });

    it('should trim entries and drop empty ones', () => {
      expect(parseInvitationCodes(' CODE1 , , CODE2 ')).toEqual(['CODE1', 'CODE2']);
    });
  });

  describe('isInvitationCodeRequired', () => {
    it('should be off when no code is configured', () => {
      expect(isInvitationCodeRequired()).toBe(false);
    });

    it('should be on when at least one code is configured', () => {
      setCodes('CODE1');
      expect(isInvitationCodeRequired()).toBe(true);
    });
  });

  describe('isInvitationCodeValid', () => {
    it('should accept any code while the gate is off', () => {
      expect(isInvitationCodeValid(undefined)).toBe(true);
      expect(isInvitationCodeValid('whatever')).toBe(true);
    });

    it('should reject a missing code while the gate is on', () => {
      setCodes('CODE1');
      expect(isInvitationCodeValid(undefined)).toBe(false);
      expect(isInvitationCodeValid(null)).toBe(false);
      expect(isInvitationCodeValid('')).toBe(false);
    });

    it('should accept a configured code, ignoring surrounding whitespace', () => {
      setCodes('CODE1,CODE2');
      expect(isInvitationCodeValid('CODE2')).toBe(true);
      expect(isInvitationCodeValid('  CODE2  ')).toBe(true);
    });

    it('should reject an unconfigured code', () => {
      setCodes('CODE1');
      expect(isInvitationCodeValid('CODE2')).toBe(false);
      expect(isInvitationCodeValid('code1')).toBe(false);
      expect(isInvitationCodeValid('CODE')).toBe(false);
    });
  });

  describe('readInvitationCodeCookie', () => {
    it('should return undefined when the cookie header is absent or has no match', () => {
      expect(readInvitationCodeCookie(undefined)).toBeUndefined();
      expect(readInvitationCodeCookie('')).toBeUndefined();
      expect(readInvitationCodeCookie('session=abc; other=1')).toBeUndefined();
    });

    it('should pick the code out of a multi-cookie header', () => {
      expect(
        readInvitationCodeCookie(`session=abc; ${INVITATION_CODE_COOKIE}=CODE1; theme=dark`),
      ).toBe('CODE1');
    });

    it('should decode the cookie value', () => {
      expect(readInvitationCodeCookie(`${INVITATION_CODE_COOKIE}=CODE%201`)).toBe('CODE 1');
    });
  });

  describe('buildInvitationCodeCookie', () => {
    it('should keep the cookie unreadable to scripts and on the top-level navigation back', () => {
      const cookie = buildInvitationCodeCookie('CODE1', true);
      expect(cookie).toContain(`${INVITATION_CODE_COOKIE}=CODE1`);
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).toContain('Path=/');
    });

    it('should only mark the cookie secure over https', () => {
      expect(buildInvitationCodeCookie('CODE1', true)).toContain('Secure');
      expect(buildInvitationCodeCookie('CODE1', false)).not.toContain('Secure');
    });
  });
});
