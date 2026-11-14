import { describe, expect, it } from 'vitest';

import { getQqGroupMemberRole } from './role';

describe('getQqGroupMemberRole', () => {
  it('reads member_role from the raw group event author', () => {
    expect(getQqGroupMemberRole({ raw: { author: { member_role: 'owner' } } })).toBe('owner');
    expect(getQqGroupMemberRole({ raw: { author: { member_role: 'admin' } } })).toBe('admin');
    expect(getQqGroupMemberRole({ raw: { author: { member_role: 'member' } } })).toBe('member');
  });

  it('fails closed when the raw payload does not include a supported role', () => {
    expect(getQqGroupMemberRole({ raw: { author: {} } })).toBeUndefined();
    expect(getQqGroupMemberRole({ raw: { author: { member_role: 'unknown' } } })).toBeUndefined();
    expect(getQqGroupMemberRole(undefined)).toBeUndefined();
  });
});
