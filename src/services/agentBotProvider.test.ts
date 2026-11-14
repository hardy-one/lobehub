import { beforeEach, describe, expect, it, vi } from 'vitest';

import { agentBotProviderService } from './agentBotProvider';

const { createOwnerBindingCode } = vi.hoisted(() => ({ createOwnerBindingCode: vi.fn() }));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    agentBotProvider: {
      createOwnerBindingCode: { mutate: createOwnerBindingCode },
    },
  },
}));

describe('agentBotProviderService.createOwnerBindingCode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a QQ owner binding code through the provider mutation', async () => {
    const params = { applicationId: 'qq-app', platform: 'qq' };
    const result = { code: 'AB12', expiresAt: Date.now() + 60_000 };
    createOwnerBindingCode.mockResolvedValue(result);

    await expect(agentBotProviderService.createOwnerBindingCode(params)).resolves.toEqual(result);
    expect(createOwnerBindingCode).toHaveBeenCalledWith(params);
  });
});
