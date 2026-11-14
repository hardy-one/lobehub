import { describe, expect, it } from 'vitest';

import type { FieldSchema } from '@/server/services/bot/platforms/types';

import {
  accessIssues,
  applyDmPolicy,
  countListed,
  deriveDmPolicy,
  dropHiddenIncompleteRows,
  getDeclaredPolicy,
} from './accessStance';

const telegramDmPolicy: FieldSchema = {
  enum: ['open', 'allowlist', 'pairing', 'disabled'],
  key: 'dmPolicy',
  label: 'channel.dmPolicy',
  type: 'string',
};
const qqDmPolicy: FieldSchema = {
  enum: ['open', 'pairing', 'disabled'],
  key: 'dmPolicy',
  label: 'channel.dmPolicy',
  type: 'string',
};
const qqGroupPolicy: FieldSchema = {
  enum: ['open', 'pairing', 'admins'],
  key: 'groupPolicy',
  label: 'channel.groupPolicy',
  type: 'string',
};
const qqGroupAllowFrom: FieldSchema = {
  key: 'groupAllowFrom',
  label: 'channel.groupAllowFrom',
  type: 'array',
  visibleWhen: { field: 'groupPolicy', value: 'pairing' },
};
const listed = [{ id: '1' }, { id: ' ' }, { id: '2', name: 'Ada' }];

describe('countListed', () => {
  it('counts only rows that carry an ID', () => {
    expect(countListed(listed)).toBe(2);
    expect(countListed(undefined)).toBe(0);
    expect(countListed('1,2')).toBe(0);
  });
});

describe('getDeclaredPolicy', () => {
  it('maps a QQ legacy allowlist value to the declared pairing policy', () => {
    expect(getDeclaredPolicy(qqDmPolicy, 'allowlist')).toBe('pairing');
    expect(getDeclaredPolicy(qqGroupPolicy, 'allowlist')).toBe('pairing');
  });

  it('preserves a legacy value that the field no longer declares', () => {
    expect(getDeclaredPolicy(qqGroupPolicy, 'disabled')).toBe('disabled');
  });
});

describe('deriveDmPolicy', () => {
  it('keeps the existing global-list behavior when the field declares allowlist', () => {
    expect(deriveDmPolicy({ allowFrom: listed, dmPolicy: 'open' }, telegramDmPolicy)).toBe(
      'allowlist',
    );
    expect(deriveDmPolicy({ dmPolicy: 'allowlist' }, telegramDmPolicy)).toBe('allowlist');
  });

  it('shows QQ open as open even when approved users are stored', () => {
    expect(deriveDmPolicy({ allowFrom: listed, dmPolicy: 'open' }, qqDmPolicy)).toBe('open');
  });

  it('shows QQ legacy allowlist as pairing and keeps declared Telegram policies unchanged', () => {
    expect(deriveDmPolicy({ dmPolicy: 'allowlist' }, qqDmPolicy)).toBe('pairing');
    expect(deriveDmPolicy({ dmPolicy: 'disabled' }, telegramDmPolicy)).toBe('disabled');
  });
});

describe('applyDmPolicy', () => {
  it('clears a global list when opening a platform that declares allowlist', () => {
    expect(applyDmPolicy('open', { allowFrom: listed }, telegramDmPolicy)).toEqual({
      dropped: 2,
      patch: { allowFrom: [], dmPolicy: 'open' },
    });
  });

  it('preserves QQ approval records when opening DMs', () => {
    expect(applyDmPolicy('open', { allowFrom: listed }, qqDmPolicy)).toEqual({
      dropped: 0,
      patch: { dmPolicy: 'open' },
    });
  });
});

describe('accessIssues', () => {
  it('treats QQ legacy allowlist as pairing and requires a bound owner', () => {
    expect(accessIssues({ dmPolicy: 'allowlist' }, qqDmPolicy)).toEqual(['approverMissing']);
    expect(accessIssues({ dmPolicy: 'allowlist', userId: 'owner-1' }, qqDmPolicy)).toEqual([]);
  });

  it('flags empty lists for platforms that declare list-based access', () => {
    expect(accessIssues({ dmPolicy: 'allowlist' }, telegramDmPolicy)).toEqual(['listEmpty']);
    expect(accessIssues({ groupAllowFrom: [], groupPolicy: 'allowlist' })).toEqual([
      'groupListEmpty',
    ]);
  });

  it('is quiet for the default open setup', () => {
    expect(accessIssues({ dmPolicy: 'open', groupPolicy: 'open' }, telegramDmPolicy)).toEqual([]);
  });
});

describe('dropHiddenIncompleteRows', () => {
  it('drops an unfinished device row when devices return to owner only', () => {
    expect(
      dropHiddenIncompleteRows({
        deviceAllowFrom: [{ id: '7' }, { id: '' }],
        devicePolicy: 'owner',
      }),
    ).toEqual({ deviceAllowFrom: [{ id: '7' }] });
  });

  it('keeps an unfinished device row while the device list is shown', () => {
    expect(
      dropHiddenIncompleteRows({ deviceAllowFrom: [{ id: '' }], devicePolicy: 'allowlist' }),
    ).toEqual({});
  });

  it('keeps QQ group approval rows visible for the migrated pairing value', () => {
    expect(
      dropHiddenIncompleteRows(
        {
          groupAllowFrom: [{ id: '' }],
          groupPolicy: 'allowlist',
        },
        [qqGroupPolicy, qqGroupAllowFrom],
      ),
    ).toEqual({});
  });

  it('preserves QQ legacy disabled while pruning a hidden unfinished row', () => {
    const patch = dropHiddenIncompleteRows(
      {
        groupAllowFrom: [{ id: '' }],
        groupPolicy: 'disabled',
      },
      [qqGroupPolicy, qqGroupAllowFrom],
    );

    expect({ groupPolicy: 'disabled', ...patch }).toEqual({
      groupAllowFrom: [],
      groupPolicy: 'disabled',
    });
    expect(getDeclaredPolicy(qqGroupPolicy, 'disabled')).toBe('disabled');
  });

  it('removes an unfinished people row only when its list is hidden', () => {
    expect(dropHiddenIncompleteRows({ allowFrom: [{ id: '  ' }], dmPolicy: 'disabled' })).toEqual({
      allowFrom: [],
    });
    expect(dropHiddenIncompleteRows({ allowFrom: [{ id: '' }], dmPolicy: 'pairing' })).toEqual({});
  });
});
