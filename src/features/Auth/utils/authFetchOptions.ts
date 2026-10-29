import { headersToRecord } from '@lobechat/fetch-sse/headers';

import { CAPTCHA_RESPONSE_HEADER } from '@/libs/better-auth/captcha';
import { INVITATION_CODE_HEADER } from '@/libs/better-auth/invitation-code';

export interface AuthFetchOptions {
  headers?: HeadersInit;
  query?: Record<string, unknown>;
}

export const withCaptchaToken = (
  fetchOptions: AuthFetchOptions | undefined,
  captchaToken: string,
) => ({
  ...fetchOptions,
  headers: {
    ...headersToRecord(fetchOptions?.headers),
    [CAPTCHA_RESPONSE_HEADER]: captchaToken,
  },
});

/**
 * The code only travels as a header on requests that can create an account, so
 * it never lands in a URL or a request body.
 */
export const withInvitationCode = (
  fetchOptions: AuthFetchOptions | undefined,
  invitationCode?: string,
): AuthFetchOptions | undefined => {
  const code = invitationCode?.trim();
  if (!code) return fetchOptions;

  return {
    ...fetchOptions,
    headers: {
      ...headersToRecord(fetchOptions?.headers),
      [INVITATION_CODE_HEADER]: code,
    },
  };
};
