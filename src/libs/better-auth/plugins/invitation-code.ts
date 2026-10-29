import { APIError, createAuthMiddleware } from 'better-auth/api';
import { type BetterAuthPlugin } from 'better-auth/types';

import {
  INVITATION_CODE_COOKIE,
  INVITATION_CODE_COOKIE_MAX_AGE,
  INVITATION_CODE_INVALID_CODE,
  INVITATION_CODE_INVALID_MESSAGE,
  INVITATION_CODE_REQUIRED_CODE,
  INVITATION_CODE_REQUIRED_MESSAGE,
} from '@/libs/better-auth/invitation-code';
import {
  INVITATION_CODE_HEADER,
  isInvitationCodeRequired,
  isInvitationCodeValid,
} from '@/libs/better-auth/utils/invitation-code';

/**
 * Sign-in callbacks run after the provider has already decided this person may
 * sign in, and they arrive as a browser redirect, so no request header of ours
 * can reach them. Whether a new account may be created through a provider is
 * therefore the provider's call, not ours.
 */
const PROVIDER_CALLBACK_PATHS = ['/callback', '/oauth2/callback'];

const MAGIC_LINK_REQUEST_PATH = '/sign-in/magic-link';
const MAGIC_LINK_VERIFY_PATH = '/magic-link/verify';
const DEFAULT_AUTH_BASE_PATH = '/api/auth';
const DEFAULT_APP_ERROR_PATH = '/auth-error';

const isProviderCallback = (path?: string) =>
  !!path && PROVIDER_CALLBACK_PATHS.some((prefix) => path.startsWith(`${prefix}/`));

interface RequestLikeContext {
  context: {
    baseURL?: string;
    internalAdapter: {
      findUserByEmail: (email: string) => Promise<{ user: { id: string } } | null>;
      findVerificationValue: (identifier: string) => Promise<{ value: string } | null>;
    };
    options: { basePath?: string };
  };
  headers?: Headers;
  query?: Record<string, unknown>;
}

const getAuthBasePath = (context: RequestLikeContext) =>
  (context.context.options.basePath ?? DEFAULT_AUTH_BASE_PATH).replace(/\/$/, '') ||
  DEFAULT_AUTH_BASE_PATH;

const readCookie = (headers: Headers | undefined, name: string): string | undefined => {
  const raw = headers?.get('cookie');
  if (!raw) return undefined;

  for (const part of raw.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;

    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return undefined;
};

/**
 * The code a request is carrying. A header wins because that is how API clients
 * present it; the cookie is the browser's copy, bound to the email request.
 */
const readInvitationCode = (context: Pick<RequestLikeContext, 'headers'> | null | undefined) =>
  context?.headers?.get(INVITATION_CODE_HEADER)?.trim() ||
  readCookie(context?.headers, INVITATION_CODE_COOKIE);

/** Turn the auth base URL into an app URL, preserving a deployment sub-path. */
const getAppUrl = (context: RequestLikeContext, path: string) => {
  const base = new URL(context.context.baseURL ?? 'http://localhost');
  const basePath = getAuthBasePath(context);
  const appPrefix = base.pathname.endsWith(basePath)
    ? base.pathname.slice(0, -basePath.length)
    : '';

  return new URL(`${appPrefix}${path}`, base.origin);
};

/** Whether the pending magic link belongs to an account that already exists. */
const isExistingAccountLink = async (context: RequestLikeContext, token?: unknown) => {
  if (typeof token !== 'string' || !token) return false;

  const pending = await context.context.internalAdapter.findVerificationValue(token);
  if (!pending) return false;

  try {
    const { email } = JSON.parse(pending.value) as { email?: string };
    if (!email) return false;

    const existing = await context.context.internalAdapter.findUserByEmail(email);
    return !!existing?.user;
  } catch {
    return false;
  }
};

/**
 * Restricts account creation to holders of a code from `AUTH_INVITATION_CODES`.
 * Unset means the gate is off and sign-up stays open.
 *
 * The gate sits on the account-creation hook rather than on individual
 * endpoints, so it covers every self-serve path that can create a user —
 * email/password, magic link, OTP and passkey — instead of only the endpoints we
 * remember to list.
 *
 * Magic link is the one flow with two legs. The request leg is a POST that can
 * carry `x-invitation-code`; the verification leg is a browser GET navigation
 * that cannot. The request leg therefore drops the validated code into a
 * short-lived cookie, and the verification leg rejects a new-account link
 * before the token is consumed when that cookie is missing or invalid. The
 * code is tied to the pending link, not to the verify path: the path itself
 * stays gated, and an existing account can still sign in without a code.
 */
export const invitationCode = (): BetterAuthPlugin => ({
  id: 'invitation-code',
  init() {
    return {
      options: {
        databaseHooks: {
          user: {
            create: {
              before: async (user, context) => {
                if (!isInvitationCodeRequired()) return { data: user };
                if (isProviderCallback(context?.path)) return { data: user };

                const code = readInvitationCode(context);

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
  hooks: {
    before: [
      {
        matcher: (context) => context.path === MAGIC_LINK_REQUEST_PATH,
        handler: createAuthMiddleware(async (context) => {
          if (!isInvitationCodeRequired()) return;

          const code = context.headers?.get(INVITATION_CODE_HEADER)?.trim();
          // No code on the request is allowed: an existing account does not need
          // one, and refusing here would reveal whether the address is known.
          if (!code) return;

          if (!isInvitationCodeValid(code)) {
            throw new APIError('FORBIDDEN', {
              code: INVITATION_CODE_INVALID_CODE,
              message: INVITATION_CODE_INVALID_MESSAGE,
            });
          }
        }),
      },
      {
        matcher: (context) => context.path === MAGIC_LINK_VERIFY_PATH,
        handler: createAuthMiddleware(async (context) => {
          if (!isInvitationCodeRequired()) return;

          // Invalid or expired links are the endpoint's business; it reports
          // INVALID_TOKEN without creating anything.
          if (!(await isExistingAccountLink(context, context.query?.token))) {
            const code = readInvitationCode(context);
            if (code && isInvitationCodeValid(code)) return;

            const errorUrl = getAppUrl(context, DEFAULT_APP_ERROR_PATH);
            errorUrl.searchParams.set(
              'error',
              code ? INVITATION_CODE_INVALID_CODE : INVITATION_CODE_REQUIRED_CODE,
            );
            // Throwing before the endpoint runs keeps the one-time token intact,
            // so the same link can be retried once the code is supplied.
            throw context.redirect(errorUrl.toString());
          }
        }),
      },
    ],
    after: [
      {
        // A before hook cannot add a response header to a successful call (the
        // endpoint's own headers replace it), so the cookie is attached here.
        matcher: (context) => context.path === MAGIC_LINK_REQUEST_PATH,
        handler: createAuthMiddleware(async (context) => {
          if (!isInvitationCodeRequired()) return;

          const code = context.headers?.get(INVITATION_CODE_HEADER)?.trim();
          if (!code || !isInvitationCodeValid(code)) return;

          context.setCookie(INVITATION_CODE_COOKIE, code, {
            httpOnly: true,
            maxAge: INVITATION_CODE_COOKIE_MAX_AGE,
            path: getAuthBasePath(context),
            sameSite: 'lax',
            secure: (context.context.baseURL ?? '').startsWith('https://'),
          });
        }),
      },
    ],
  },
});
