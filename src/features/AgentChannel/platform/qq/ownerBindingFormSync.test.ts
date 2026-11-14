import { describe, expect, it, vi } from 'vitest';

import { isOwnerBindingComplete, syncOwnerBindingUserId } from './ownerBindingFormSync';

describe('isOwnerBindingComplete', () => {
  // LOBE-166 regression: `provider.updatedAt` moves on ANY settings save. The
  // old implementation inferred "bind complete" from it and reported success
  // immediately after clicking 重新绑定, before the new code could be used.
  // `updatedAt` / `issuedAt` are no longer inputs to the decision at all.
  it('does not treat an unrelated settings save (updatedAt change) as a completed bind', () => {
    const previous = {
      boundAt: '2026-11-13T09:00:00.000Z',
      ownerId: 'owner-qq-id',
      updatedAt: '2026-11-13T09:00:00.000Z',
    };
    const current = {
      boundAt: '2026-11-13T09:00:00.000Z',
      ownerId: 'owner-qq-id',
      // A settings save bumped the row, but no /bind happened.
      updatedAt: '2026-11-14T10:30:00.000Z',
    };

    expect(isOwnerBindingComplete(previous, current)).toBe(false);
  });

  it('completes when a different owner is bound', () => {
    expect(
      isOwnerBindingComplete(
        { boundAt: '2026-11-13T09:00:00.000Z', ownerId: 'owner-qq-id' },
        { boundAt: '2026-11-14T11:00:00.000Z', ownerId: 'another-qq-id' },
      ),
    ).toBe(true);
  });

  it('completes a same-owner rebind when /bind writes a new ownerBoundAt', () => {
    expect(
      isOwnerBindingComplete(
        { boundAt: '2026-11-13T09:00:00.000Z', ownerId: 'owner-qq-id' },
        { boundAt: '2026-11-14T11:00:00.000Z', ownerId: 'owner-qq-id' },
      ),
    ).toBe(true);
  });

  it('detects the first bind on a legacy row that has no ownerBoundAt yet', () => {
    expect(
      isOwnerBindingComplete(
        { ownerId: 'owner-qq-id' },
        { boundAt: '2026-11-14T11:00:00.000Z', ownerId: 'owner-qq-id' },
      ),
    ).toBe(true);
  });

  it('fails closed when ownerBoundAt is missing and the owner is unchanged', () => {
    expect(isOwnerBindingComplete({ ownerId: 'owner-qq-id' }, { ownerId: 'owner-qq-id' })).toBe(
      false,
    );
    // A stale cached marker must not be "cleared" into a completion either.
    expect(
      isOwnerBindingComplete(
        { boundAt: '2026-11-13T09:00:00.000Z', ownerId: 'owner-qq-id' },
        { ownerId: 'owner-qq-id' },
      ),
    ).toBe(false);
  });

  it('does not complete when no owner id is present', () => {
    expect(
      isOwnerBindingComplete(
        { boundAt: '2026-11-13T09:00:00.000Z' },
        { boundAt: '2026-11-14T11:00:00.000Z' },
      ),
    ).toBe(false);
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
