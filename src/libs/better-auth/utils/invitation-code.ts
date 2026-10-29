import { authEnv } from '@/envs/auth';

/**
 * Carries the code on a sign-up request itself, so it never lands in a URL or a
 * request body.
 */
export const INVITATION_CODE_HEADER = 'x-invitation-code';

/** Accepts the full-width comma so codes can be listed the way they are typed. */
export const parseInvitationCodes = (value?: string): string[] => {
  const codes = value?.trim();
  if (!codes) return [];
  return codes
    .split(/[,，]/)
    .map((code) => code.trim())
    .filter(Boolean);
};

/** No configured codes means the gate is off and sign-up stays open. */
export const isInvitationCodeRequired = (): boolean =>
  parseInvitationCodes(authEnv.AUTH_INVITATION_CODES).length > 0;

/**
 * A disabled gate accepts any code, including none, so callers can validate
 * before checking whether the gate is on.
 */
export const isInvitationCodeValid = (code?: null | string): boolean => {
  const codes = parseInvitationCodes(authEnv.AUTH_INVITATION_CODES);
  if (codes.length === 0) return true;

  return !!code && codes.includes(code.trim());
};
