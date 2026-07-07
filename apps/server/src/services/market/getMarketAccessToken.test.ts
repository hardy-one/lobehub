import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { getMarketAccessToken } from './getMarketAccessToken';

const { mockGetUserSettings, mockLog, MockUserModel } = vi.hoisted(() => {
  const mockGetUserSettings = vi.fn();
  const mockLog = vi.fn();

  return {
    MockUserModel: vi.fn(() => ({ getUserSettings: mockGetUserSettings })),
    mockGetUserSettings,
    mockLog,
  };
});

vi.mock('@/database/models/user', () => ({ UserModel: MockUserModel }));
vi.mock('debug', () => ({ default: vi.fn(() => mockLog) }));

describe('getMarketAccessToken', () => {
  const db = {} as LobeChatDatabase;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a trimmed persisted Market token', async () => {
    mockGetUserSettings.mockResolvedValue({ market: { accessToken: '  market-token  ' } });

    await expect(getMarketAccessToken(db, 'user-1')).resolves.toBe('market-token');
  });

  it.each([
    undefined,
    null,
    {},
    { market: null },
    { market: { accessToken: '   ' } },
    { market: { accessToken: 42 } },
  ])('ignores malformed or empty settings: %j', async (settings) => {
    mockGetUserSettings.mockResolvedValue(settings);

    await expect(getMarketAccessToken(db, 'user-1')).resolves.toBeUndefined();
  });

  it('falls back without throwing when settings cannot be read', async () => {
    const error = new Error('database unavailable');
    mockGetUserSettings.mockRejectedValue(error);

    await expect(getMarketAccessToken(db, 'user-1')).resolves.toBeUndefined();
    expect(mockLog).toHaveBeenCalledWith(
      'getMarketAccessToken: failed to read token for user %s: %O',
      'user-1',
      error,
    );
  });
});
