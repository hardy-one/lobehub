// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  claimOwnerBindingCode,
  completeOwnerBindingCode,
  createOwnerBindingCode,
  OWNER_BINDING_TTL_SECONDS,
  releaseOwnerBindingCode,
} from './ownerBindingStore';

const { mockClaim, mockComplete, mockIssue, mockRelease } = vi.hoisted(() => ({
  mockClaim: vi.fn(),
  mockComplete: vi.fn(),
  mockIssue: vi.fn(),
  mockRelease: vi.fn(),
}));

vi.mock('@/server/services/redis', () => ({
  redisService: {
    ownerBinding: {
      claim: mockClaim,
      complete: mockComplete,
      issue: mockIssue,
      release: mockRelease,
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockIssue.mockResolvedValue(901_000);
  mockClaim.mockResolvedValue('claimed');
  mockComplete.mockResolvedValue('consumed');
  mockRelease.mockResolvedValue(undefined);
});

describe('createOwnerBindingCode', () => {
  it('issues one Crockford code with a 15-minute expiry', async () => {
    const result = await createOwnerBindingCode({ applicationId: 'qq-app', platform: 'qq' });

    expect(result.status).toBe('created');
    if (result.status !== 'created') throw new Error('unreachable');
    expect(result.code).toMatch(/^[A-HJKMNP-TV-Z2-9]{8}$/);
    expect(result.expiresAt).toBe(901_000);
    expect(OWNER_BINDING_TTL_SECONDS).toBe(15 * 60);
    expect(mockIssue).toHaveBeenCalledWith('qq', 'qq-app', result.code);
  });

  it('reports Redis absence or failure as unavailable', async () => {
    mockIssue.mockResolvedValueOnce(null);
    await expect(
      createOwnerBindingCode({ applicationId: 'qq-app', platform: 'qq' }),
    ).resolves.toEqual({ status: 'redis-unavailable' });
  });
});

describe('owner binding code lifecycle', () => {
  it('claims a code case-insensitively before the provider write', async () => {
    await expect(
      claimOwnerBindingCode({ applicationId: 'qq-app', code: '  abcd2345 ', platform: 'qq' }),
    ).resolves.toBe('claimed');
    expect(mockClaim).toHaveBeenCalledWith('qq', 'qq-app', 'abcd2345'.toUpperCase());
  });

  it('distinguishes an invalid/expired code from Redis unavailability', async () => {
    mockClaim.mockResolvedValueOnce('invalid');
    await expect(
      claimOwnerBindingCode({ applicationId: 'qq-app', code: 'wrong-code', platform: 'qq' }),
    ).resolves.toBe('invalid');

    mockClaim.mockResolvedValueOnce('unavailable');
    await expect(
      claimOwnerBindingCode({
        applicationId: 'qq-app',
        code: 'abcd2345'.toUpperCase(),
        platform: 'qq',
      }),
    ).resolves.toBe('redis-unavailable');
  });

  it('consumes the claimed code after a successful provider write', async () => {
    await expect(
      completeOwnerBindingCode({ applicationId: 'qq-app', code: ' abcd2345 ', platform: 'qq' }),
    ).resolves.toBe('consumed');
    expect(mockComplete).toHaveBeenCalledWith('qq', 'qq-app', 'abcd2345'.toUpperCase());
  });

  it('releases a claim after a failed provider write so the code can be retried', async () => {
    await releaseOwnerBindingCode({ applicationId: 'qq-app', code: ' abcd2345 ', platform: 'qq' });
    expect(mockRelease).toHaveBeenCalledWith('qq', 'qq-app', 'abcd2345'.toUpperCase());
  });
});
