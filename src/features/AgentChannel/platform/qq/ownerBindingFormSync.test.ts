import { describe, expect, it, vi } from 'vitest';

import { isOwnerBindingComplete, syncOwnerBindingUserId } from './ownerBindingFormSync';

describe('isOwnerBindingComplete', () => {
  const issuedAt = Date.parse('2026-11-13T10:00:01.000Z');

  it('detects a new owner even when the provider has no version metadata', () => {
    expect(isOwnerBindingComplete(undefined, undefined, 'owner-qq-id', undefined, issuedAt)).toBe(
      true,
    );
  });

  it('detects a same-owner bind from the provider update after code issuance', () => {
    expect(
      isOwnerBindingComplete(
        'owner-qq-id',
        undefined,
        'owner-qq-id',
        new Date('2026-11-13T10:00:02.000Z'),
        issuedAt,
      ),
    ).toBe(true);
  });

  it('keeps same-owner binding pending when the provider update predates the code', () => {
    expect(
      isOwnerBindingComplete(
        'owner-qq-id',
        undefined,
        'owner-qq-id',
        new Date('2026-11-13T10:00:00.000Z'),
        issuedAt,
      ),
    ).toBe(false);
  });

  it('detects a changed provider version even if its clock is behind code issuance', () => {
    expect(
      isOwnerBindingComplete(
        'owner-qq-id',
        '2026-11-13T10:00:00.000Z',
        'owner-qq-id',
        new Date('2026-11-13T09:59:59.000Z'),
        issuedAt,
      ),
    ).toBe(true);
  });
});

describe('syncOwnerBindingUserId', () => {
  it('merges the server-bound owner into settings and preserves unsaved access edits', () => {
    let settings: Record<string, unknown> = {
      charLimit: 1900,
      devicePolicy: 'allowlist',
      dmPolicy: 'pairing',
      groupPolicy: 'admins',
      userId: '',
    };
    const form = {
      getSettings: () => settings,
      setSettings: (next: Record<string, unknown>) => {
        settings = next;
      },
      validate: vi.fn().mockResolvedValue(undefined),
    };
    const onFilled = vi.fn();

    expect(syncOwnerBindingUserId(form, ' owner-qq-id ', onFilled)).toBe(true);
    expect(settings).toEqual({
      charLimit: 1900,
      devicePolicy: 'allowlist',
      dmPolicy: 'pairing',
      groupPolicy: 'admins',
      userId: 'owner-qq-id',
    });
    expect(form.validate).toHaveBeenCalledWith(['settings.userId']);
    expect(onFilled).toHaveBeenCalledOnce();
  });

  it('does nothing when the bound ID is empty or already in the form', () => {
    const form = {
      getSettings: () => ({ dmPolicy: 'open', userId: 'owner-qq-id' }),
      setSettings: vi.fn(),
      validate: vi.fn(),
    };

    expect(syncOwnerBindingUserId(form, '  ')).toBe(false);
    expect(syncOwnerBindingUserId(form, 'owner-qq-id')).toBe(false);
    expect(form.setSettings).not.toHaveBeenCalled();
    expect(form.validate).not.toHaveBeenCalled();
  });
});
