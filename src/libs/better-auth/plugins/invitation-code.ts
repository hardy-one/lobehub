import { APIError } from 'better-auth/api';
import { type BetterAuthPlugin } from 'better-auth/types';

import { appEnv } from '@/envs/app';
import {
  INVITATION_CODE_INVALID_CODE,
  INVITATION_CODE_INVALID_MESSAGE,
  INVITATION_CODE_REQUIRED_CODE,
  INVITATION_CODE_REQUIRED_MESSAGE,
} from '@/libs/better-auth/invitation-code';
import {
  buildInvitationCodeCookie,
  INVITATION_CODE_HEADER,
  isInvitationCodeRequired,
  isInvitationCodeValid,
  readInvitationCodeCookie,
} from '@/libs/better-auth/utils/invitation-code';

/**
 * Endpoints that may start an OAuth flow ending in a new account. The provider
 * sends the browser back to `/callback/*` with none of our headers attached, so
 * the code has to be parked in a cookie before it leaves our origin.
 */
const OAUTH_START_PATHS = ['/sign-in/oauth2', '/sign-in/social'];

const usesSecureCookies = (): boolean => (appEnv.APP_URL || '').startsWith('https://');

/**
 * The `hooks` context types request headers as `HeadersInit` rather than the
 * `Headers` the router actually passes.
 */
const readHeader = (headers: HeadersInit | undefined, name: string): null | string => {
  if (!headers) return null;
  if (headers instanceof Headers) return headers.get(name);
  if (Array.isArray(headers))
    return headers.find(([key]) => key.toLowerCase() === name)?.[1] ?? null;

  return (headers as Record<string, string>)[name] ?? null;
};

/**
 * Restricts account creation to holders of a code from `AUTH_INVITATION_CODES`.
 * Unset means the gate is off and sign-up stays open.
 *
 * The gate sits on the account-creation hook rather than on individual endpoints,
 * so it covers every path that can create a user — email/password, magic link,
 * OTP, passkey and OAuth — instead of only the endpoints we remember to list.
 */
export const invitationCode = (): BetterAuthPlugin => ({
  id: 'invitation-code',
  hooks: {
    after: [
      {
        matcher: (ctx) => !!ctx.path && OAUTH_START_PATHS.includes(ctx.path),
        handler: async (ctx) => {
          const headers = new Headers();
          const code = readHeader(ctx.headers, INVITATION_CODE_HEADER);

          // The request cannot be rejected here: signing in with an already
          // registered OAuth account uses the same endpoint, and that must keep
          // working without a code. Only account creation is gated, below.
          if (isInvitationCodeRequired() && code && isInvitationCodeValid(code)) {
            headers.append('set-cookie', buildInvitationCodeCookie(code, usesSecureCookies()));
          }

          // Must stay async and always resolve to an object: Better Auth calls
          // `.catch()` on the hook result and reads `headers` off it, so a plain
          // value or `undefined` fails the whole request.
          return { headers };
        },
      },
    ],
  },
  init() {
    return {
      options: {
        databaseHooks: {
          user: {
            create: {
              before: async (user, context) => {
                if (!isInvitationCodeRequired()) return { data: user };

                const code =
                  context?.headers?.get(INVITATION_CODE_HEADER) ??
                  readInvitationCodeCookie(context?.headers?.get('cookie'));

                if (!code) {
                  throw new APIError('FORBIDDEN', {
                    code: INVITATION_CODE_REQUIRED_CODE,
                    message: INVITATION_CODE_REQUIRED_MESSAGE,
                  });
                }

                if (!isInvitationCodeValid(code)) {
                  throw new APIError('FORBIDDEN', {
                    code: INVITATION_CODE_INVALID_CODE,
                    message: INVITATION_CODE_INVALID_MESSAGE,
                  });
                }

                return { data: user };
              },
            },
          },
        },
      },
    };
  },
});
