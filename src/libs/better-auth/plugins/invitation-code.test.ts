import { beforeEach, describe, expect, it, vi } from 'vitest';

// Get mocked module
import { authEnv } from '@/envs/auth';

import { invitationCode } from './invitation-code';

vi.mock('@/envs/auth', () => ({
  authEnv: {
    AUTH_INVITATION_CODES: undefined as string | undefined,
  },
}));

const setCodes = (value?: string) => {
  (authEnv as { AUTH_INVITATION_CODES: string | undefined }).AUTH_INVITATION_CODES = value;
};

interface CreateUserContext {
  headers?: Headers;
  path?: string;
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

const USER = { email: 'user@example.com' };

const signUpContext = (options: { code?: string; cookie?: string; path?: string } = {}) => ({
  headers: new Headers({
    ...(options.code ? { 'x-invitation-code': options.code } : {}),
    ...(options.cookie ? { cookie: options.cookie } : {}),
  }),
  path: options.path ?? '/sign-up/email',
});

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

  it('should create the account while the gate is off', async () => {
    const before = getCreateBefore();

    await expect(before(USER, signUpContext())).resolves.toEqual({ data: USER });
  });

  it('should accept a code sent on the request', async () => {
    setCodes('CODE1,CODE2');
    const before = getCreateBefore();

    await expect(before(USER, signUpContext({ code: 'CODE2' }))).resolves.toEqual({ data: USER });
  });

  it('should accept the code the magic-link request stored in the browser', async () => {
    setCodes('CODE1');
    const before = getCreateBefore();
    const context = signUpContext({
      cookie: 'lobe-invitation-code=CODE1',
      path: '/magic-link/verify',
    });

    await expect(before(USER, context)).resolves.toEqual({ data: USER });
  });

  it('should refuse an invalid code carried by the cookie', async () => {
    setCodes('CODE1');
    const before = getCreateBefore();
    const context = signUpContext({
      cookie: 'lobe-invitation-code=CODE2',
      path: '/magic-link/verify',
    });

    expect(await getErrorCode(() => before(USER, context))).toBe('INVALID_INVITATION_CODE');
  });

  it('should refuse a creation without a code', async () => {
    setCodes('CODE1');
    const before = getCreateBefore();

    expect(await getErrorCode(() => before(USER, signUpContext()))).toBe(
      'INVITATION_CODE_REQUIRED',
    );
    expect(await getErrorCode(() => before(USER, null))).toBe('INVITATION_CODE_REQUIRED');
  });

  it('should refuse a creation with an unconfigured code', async () => {
    setCodes('CODE1');
    const before = getCreateBefore();

    expect(await getErrorCode(() => before(USER, signUpContext({ code: 'CODE2' })))).toBe(
      'INVALID_INVITATION_CODE',
    );
  });

  it.each(['/callback/:id', '/oauth2/callback/:providerId'])(
    'should leave account creation to the provider on %s',
    async (path) => {
      setCodes('CODE1');
      const before = getCreateBefore();

      await expect(before(USER, signUpContext({ path }))).resolves.toEqual({ data: USER });
    },
  );

  it('should still gate the self-serve paths that are not provider callbacks', async () => {
    setCodes('CODE1');
    const before = getCreateBefore();

    for (const path of ['/sign-up/email', '/sign-in/magic-link', '/email-otp/verify-email']) {
      expect(await getErrorCode(() => before(USER, signUpContext({ path })))).toBe(
        'INVITATION_CODE_REQUIRED',
      );
    }
  });
});
