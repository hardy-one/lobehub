import { authEnv } from '@/envs/auth';
import { INVITATION_CODE_HEADER } from '@/libs/better-auth/invitation-code';

export { INVITATION_CODE_HEADER };

/**
 * Carries the code across an OAuth round trip: the browser leaves our origin for
 * the provider and comes back on `/callback/*`, where the original header is gone.
 */
export const INVITATION_CODE_COOKIE = 'lobe-invitation-code';

/** Only has to survive the round trip to the provider and back. */
export const INVITATION_CODE_COOKIE_MAX_AGE = 600;

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

export const readInvitationCodeCookie = (cookieHeader?: null | string): string | undefined => {
  if (!cookieHeader) return undefined;

  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== INVITATION_CODE_COOKIE) continue;

    return decodeURIComponent(part.slice(separator + 1).trim());
  }

  return undefined;
};

export const buildInvitationCodeCookie = (code: string, secure: boolean): string =>
  [
    `${INVITATION_CODE_COOKIE}=${encodeURIComponent(code)}`,
    'Path=/',
    `Max-Age=${INVITATION_CODE_COOKIE_MAX_AGE}`,
    'HttpOnly',
    // Lax keeps the cookie on the top-level navigation back from the provider.
    'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
