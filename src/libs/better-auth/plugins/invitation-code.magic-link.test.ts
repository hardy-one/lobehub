// @vitest-environment node
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { magicLink } from 'better-auth/plugins';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { authEnv } from '@/envs/auth';

import { invitationCode } from './invitation-code';

vi.mock('@/envs/auth', () => ({
  authEnv: {
    AUTH_INVITATION_CODES: undefined as string | undefined,
  },
}));

const BASE_URL = 'http://localhost:3000';
const AUTH_BASE_PATH = '/api/auth';
const CODE = 'INVITE-1';
/** The browser-side carrier; asserted by name because it is part of the flow contract. */
const COOKIE = 'lobe-invitation-code';

const setCodes = (value?: string) => {
  (authEnv as { AUTH_INVITATION_CODES: string | undefined }).AUTH_INVITATION_CODES = value;
};

/**
 * A real Better Auth instance with the production invitation plugin and the
 * stock magic-link plugin, driven through real HTTP requests. Nothing here
 * calls the plugin hooks by hand, so the assertions cover the actual request
 * order, token consumption and cookie handling.
 */
const createAuth = () => {
  const db: Record<string, any[]> = { account: [], session: [], user: [], verification: [] };
  const sent: { email: string; url: string }[] = [];

  const auth = betterAuth({
    baseURL: BASE_URL,
    database: memoryAdapter(db),
    emailAndPassword: { enabled: true },
    plugins: [
      invitationCode(),
      magicLink({
        expiresIn: 900,
        sendMagicLink: async ({ email, url }) => {
          sent.push({ email, url });
        },
        storeToken: 'plain',
      }),
    ],
    rateLimit: { enabled: false },
    secret: 'test-secret-test-secret-test-secret',
  });

  return { auth, db, sent };
};

type Auth = ReturnType<typeof createAuth>['auth'];

const requestLink = (auth: Auth, email: string, code?: string) =>
  auth.handler(
    new Request(`${BASE_URL}${AUTH_BASE_PATH}/sign-in/magic-link`, {
      body: JSON.stringify({ email }),
      headers: {
        'content-type': 'application/json',
        'origin': BASE_URL,
        ...(code ? { 'x-invitation-code': code } : {}),
      },
      method: 'POST',
    }),
  );

const clickLink = (auth: Auth, url: string, cookie?: string) =>
  auth.handler(
    new Request(url, {
      headers: { origin: BASE_URL, ...(cookie ? { cookie } : {}) },
    }),
  );

const findSetCookie = (response: Response, name: string) => {
  const cookies = response.headers.getSetCookie?.() ?? [];
  return cookies.find((cookie) => cookie.startsWith(`${name}=`));
};

/** `name=value`, the form a browser sends back on the next navigation. */
const toCookiePair = (setCookie: string) => setCookie.split(';')[0];

const signUpExistingUser = async (auth: Auth, email: string) => {
  const response = await auth.handler(
    new Request(`${BASE_URL}${AUTH_BASE_PATH}/sign-up/email`, {
      body: JSON.stringify({ email, name: 'Existing', password: 'password-123456' }),
      headers: {
        'content-type': 'application/json',
        'origin': BASE_URL,
        'x-invitation-code': CODE,
      },
      method: 'POST',
    }),
  );
  expect(response.status).toBe(200);
};

describe('magic link with the invitation gate', () => {
  beforeEach(() => {
    setCodes(undefined);
  });

  it('binds a valid code to the link and creates the new account on the browser GET', async () => {
    setCodes(CODE);
    const { auth, db, sent } = createAuth();

    const request = await requestLink(auth, 'new@example.com', CODE);
    expect(request.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].email).toBe('new@example.com');

    const setCookie = findSetCookie(request, COOKIE);
    expect(setCookie).toBeDefined();
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\/api\/auth/i);

    const verify = await clickLink(auth, sent[0].url, toCookiePair(setCookie!));
    expect(verify.status).toBe(302);
    expect(verify.headers.get('location')).toBe(`${BASE_URL}/`);
    expect(db.user).toHaveLength(1);
    expect(db.user[0].email).toBe('new@example.com');
    expect(db.session).toHaveLength(1);
  });

  it('leaves the token usable when the first click has no code', async () => {
    setCodes(CODE);
    const { auth, db, sent } = createAuth();

    // The request leg is allowed without a code: the endpoint cannot reveal
    // whether the address already has an account.
    const request = await requestLink(auth, 'new@example.com');
    expect(request.status).toBe(200);
    expect(findSetCookie(request, COOKIE)).toBeUndefined();

    const blocked = await clickLink(auth, sent[0].url);
    expect(blocked.status).toBe(302);
    expect(blocked.headers.get('location')).toBe(
      `${BASE_URL}/auth-error?error=INVITATION_CODE_REQUIRED`,
    );
    expect(db.user).toHaveLength(0);
    // The rejected click must not consume the one-time token.
    expect(db.verification).toHaveLength(1);

    // Supplying the code on a fresh request issues the cookie. The original
    // link still verifies, proving the first click did not burn it.
    const retry = await requestLink(auth, 'new@example.com', CODE);
    const retryCookie = findSetCookie(retry, COOKIE);
    expect(retryCookie).toBeDefined();

    const verify = await clickLink(auth, sent[0].url, toCookiePair(retryCookie!));
    expect(verify.status).toBe(302);
    expect(verify.headers.get('location')).toBe(`${BASE_URL}/`);
    expect(db.user).toHaveLength(1);
  });

  it('rejects an invalid code before sending anything', async () => {
    setCodes(CODE);
    const { auth, db, sent } = createAuth();

    const request = await requestLink(auth, 'new@example.com', 'WRONG');
    expect(request.status).toBe(403);
    expect(await request.json()).toMatchObject({ code: 'INVALID_INVITATION_CODE' });
    expect(sent).toHaveLength(0);
    expect(db.verification).toHaveLength(0);

    const valid = await requestLink(auth, 'new@example.com', CODE);
    expect(valid.status).toBe(200);

    const blocked = await clickLink(auth, sent[0].url, `${COOKIE}=WRONG`);
    expect(blocked.status).toBe(302);
    expect(blocked.headers.get('location')).toBe(
      `${BASE_URL}/auth-error?error=INVALID_INVITATION_CODE`,
    );
    expect(db.user).toHaveLength(0);
    expect(db.verification).toHaveLength(1);
  });

  it('lets an existing account sign in without a code', async () => {
    setCodes(CODE);
    const { auth, db, sent } = createAuth();
    await signUpExistingUser(auth, 'existing@example.com');

    const request = await requestLink(auth, 'existing@example.com');
    expect(request.status).toBe(200);
    expect(findSetCookie(request, COOKIE)).toBeUndefined();

    const verify = await clickLink(auth, sent[0].url);
    expect(verify.status).toBe(302);
    expect(verify.headers.get('location')).toBe(`${BASE_URL}/`);
    expect(db.user).toHaveLength(1);
    expect(db.session).toHaveLength(1);
  });

  it('consumes a valid link only once on repeated clicks', async () => {
    setCodes(CODE);
    const { auth, db, sent } = createAuth();

    const request = await requestLink(auth, 'new@example.com', CODE);
    const cookie = toCookiePair(findSetCookie(request, COOKIE)!);

    const first = await clickLink(auth, sent[0].url, cookie);
    expect(first.status).toBe(302);
    expect(first.headers.get('location')).toBe(`${BASE_URL}/`);

    const second = await clickLink(auth, sent[0].url, cookie);
    expect(second.status).toBe(302);
    expect(second.headers.get('location')).toBe(`${BASE_URL}/?error=INVALID_TOKEN`);
    expect(db.user).toHaveLength(1);
  });

  it('keeps the old flow when the gate is off', async () => {
    const { auth, db, sent } = createAuth();

    const request = await requestLink(auth, 'new@example.com');
    expect(request.status).toBe(200);
    expect(findSetCookie(request, COOKIE)).toBeUndefined();

    const verify = await clickLink(auth, sent[0].url);
    expect(verify.status).toBe(302);
    expect(verify.headers.get('location')).toBe(`${BASE_URL}/`);
    expect(db.user).toHaveLength(1);
  });
});
