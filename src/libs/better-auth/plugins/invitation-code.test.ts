import { beforeEach, describe, expect, it, vi } from 'vitest';

// Get mocked module
import { authEnv } from '@/envs/auth';
import { INVITATION_CODE_COOKIE } from '@/libs/better-auth/utils/invitation-code';

import { invitationCode } from './invitation-code';

vi.mock('@/envs/auth', () => ({
  authEnv: {
    AUTH_INVITATION_CODES: undefined as string | undefined,
  },
}));

vi.mock('@/envs/app', () => ({
  appEnv: { APP_URL: 'https://lobe.example.com' },
}));

const setCodes = (value?: string) => {
  (authEnv as { AUTH_INVITATION_CODES: string | undefined }).AUTH_INVITATION_CODES = value;
};

interface CreateUserContext {
  headers?: Headers;
}

/** The account-creation gate, as Better Auth invokes it. */
const getCreateBefore = () => {
  const result = invitationCode().init!({} as never) as unknown as {
    options: {
      databaseHooks: {
        user: {
          create: {
            before: (
              user: Record<string, unknown>,
              context: CreateUserContext | null,
            ) => Promise<unknown>;
          };
        };
      };
    };
  };

  return result.options.databaseHooks.user.create.before;
};

/** The hook that parks the code in a cookie before an OAuth redirect. */
const getAfterHandler = () => {
  const hook = invitationCode().hooks!.after![0];

  return hook.handler as unknown as (ctx: {
    headers?: Headers;
    path?: string;
  }) => Promise<{ headers: Headers }>;
};

const USER = { email: 'user@example.com' };

const getErrorCode = async (run: () => Promise<unknown>) => {
  try {
    await run();
    return undefined;
  } catch (error) {
    return (error as { body?: { code?: string } }).body?.code;
  }
};

describe('invitationCode plugin', () => {
  beforeEach(() => {
    setCodes(undefined);
  });

  describe('account creation', () => {
    it('should create the account while the gate is off', async () => {
      const before = getCreateBefore();

      await expect(before(USER, { headers: new Headers() })).resolves.toEqual({ data: USER });
    });

    it('should accept a code sent on the request', async () => {
      setCodes('CODE1,CODE2');
      const before = getCreateBefore();

      const context = { headers: new Headers({ 'x-invitation-code': 'CODE2' }) };
      await expect(before(USER, context)).resolves.toEqual({ data: USER });
    });

    it('should accept the code carried over an OAuth round trip', async () => {
      setCodes('CODE1');
      const before = getCreateBefore();

      const context = {
        headers: new Headers({ cookie: `theme=dark; ${INVITATION_CODE_COOKIE}=CODE1` }),
      };
      await expect(before(USER, context)).resolves.toEqual({ data: USER });
    });

    it('should refuse a creation without a code', async () => {
      setCodes('CODE1');
      const before = getCreateBefore();

      expect(await getErrorCode(() => before(USER, { headers: new Headers() }))).toBe(
        'INVITATION_CODE_REQUIRED',
      );
      expect(await getErrorCode(() => before(USER, null))).toBe('INVITATION_CODE_REQUIRED');
    });

    it('should refuse a creation with an unconfigured code', async () => {
      setCodes('CODE1');
      const before = getCreateBefore();

      const fromHeader = { headers: new Headers({ 'x-invitation-code': 'CODE2' }) };
      expect(await getErrorCode(() => before(USER, fromHeader))).toBe('INVALID_INVITATION_CODE');

      const fromCookie = { headers: new Headers({ cookie: `${INVITATION_CODE_COOKIE}=CODE2` }) };
      expect(await getErrorCode(() => before(USER, fromCookie))).toBe('INVALID_INVITATION_CODE');
    });

    it('should prefer the request code over a stale cookie', async () => {
      setCodes('CODE1');
      const before = getCreateBefore();

      const context = {
        headers: new Headers({
          'cookie': `${INVITATION_CODE_COOKIE}=STALE`,
          'x-invitation-code': 'CODE1',
        }),
      };
      await expect(before(USER, context)).resolves.toEqual({ data: USER });
    });
  });

  describe('oauth start', () => {
    it('should only match the endpoints that can register through a provider', () => {
      const matcher = invitationCode().hooks!.after![0].matcher;

      expect(matcher({ path: '/sign-in/social' } as never)).toBe(true);
      expect(matcher({ path: '/sign-in/oauth2' } as never)).toBe(true);
      expect(matcher({ path: '/sign-up/email' } as never)).toBe(false);
      expect(matcher({} as never)).toBe(false);
    });

    it('should park the code for the callback to read', async () => {
      setCodes('CODE1');
      const handler = getAfterHandler();

      const { headers } = await handler({ headers: new Headers({ 'x-invitation-code': 'CODE1' }) });

      const cookie = headers.get('set-cookie');
      expect(cookie).toContain(`${INVITATION_CODE_COOKIE}=CODE1`);
      expect(cookie).toContain('Secure');
    });

    it('should not touch the response without a usable code', async () => {
      setCodes('CODE1');
      const handler = getAfterHandler();

      const none = await handler({ headers: new Headers() });
      expect(none).toBeDefined();
      expect(none.headers.get('set-cookie')).toBeNull();

      const invalid = await handler({ headers: new Headers({ 'x-invitation-code': 'CODE2' }) });
      expect(invalid.headers.get('set-cookie')).toBeNull();
    });

    it('should always resolve to a promise of an object, whatever the request looks like', async () => {
      const handler = getAfterHandler();

      // Better Auth calls `.catch()` on the hook result and reads `headers` off
      // it, so a plain value or `undefined` fails the whole request. Cover the
      // gate-off request and the gate-on request that carries no usable code.
      for (const codes of [undefined, 'CODE1']) {
        setCodes(codes);
        for (const headers of [new Headers(), new Headers({ 'x-invitation-code': 'CODE2' })]) {
          const result = handler({ headers });
          expect(typeof result.then).toBe('function');
          expect(await result).toEqual({ headers: expect.anything() });
        }
      }
    });
  });
});
