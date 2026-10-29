import { APIError } from 'better-auth/api';
import { type BetterAuthPlugin } from 'better-auth/types';

import {
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

const isProviderCallback = (path?: string) =>
  !!path && PROVIDER_CALLBACK_PATHS.some((prefix) => path.startsWith(`${prefix}/`));

/**
 * Restricts account creation to holders of a code from `AUTH_INVITATION_CODES`.
 * Unset means the gate is off and sign-up stays open.
 *
 * The gate sits on the account-creation hook rather than on individual
 * endpoints, so it covers every self-serve path that can create a user —
 * email/password, magic link, OTP and passkey — instead of only the endpoints we
 * remember to list.
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

                const code = context?.headers?.get(INVITATION_CODE_HEADER);

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
