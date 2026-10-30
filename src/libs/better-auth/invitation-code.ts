/**
 * Carries the code on a sign-up request itself, so it never lands in a URL or a
 * request body.
 */
export const INVITATION_CODE_HEADER = 'x-invitation-code';

/**
 * Carries a validated code from the request that sends the verification email
 * to the browser navigation that clicks it. The click is a top-level GET with
 * no way to attach a header, so the code has to travel in a cookie instead.
 *
 * Scoped to the auth base path and short-lived: it only has to outlive the
 * magic link it was issued next to.
 */
export const INVITATION_CODE_COOKIE = 'lobe-invitation-code';

/** Default magic-link lifetime (15 min) plus a minute of clock slack. */
export const INVITATION_CODE_COOKIE_MAX_AGE = 16 * 60;

export const INVITATION_CODE_REQUIRED_CODE = 'INVITATION_CODE_REQUIRED';
export const INVITATION_CODE_INVALID_CODE = 'INVALID_INVITATION_CODE';
export const INVITATION_CODE_REQUIRED_MESSAGE = 'An invitation code is required to sign up';
export const INVITATION_CODE_INVALID_MESSAGE = 'The invitation code is invalid';
