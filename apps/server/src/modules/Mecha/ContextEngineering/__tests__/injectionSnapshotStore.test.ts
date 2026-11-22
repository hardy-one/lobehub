import { InjectionSnapshotStore } from '@lobechat/context-engine';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getServerInjectionSnapshotStore } from '../injectionSnapshotStore';

afterEach(() => {
  vi.useRealTimers();
});

describe('server injection snapshot store registry', () => {
  it('returns the same store for every operation of one topic', () => {
    const first = getServerInjectionSnapshotStore('tpc_same');
    const second = getServerInjectionSnapshotStore('tpc_same');

    expect(first).toBeInstanceOf(InjectionSnapshotStore);
    expect(second).toBe(first);
  });

  it('isolates different topics', () => {
    expect(getServerInjectionSnapshotStore('tpc_a')).not.toBe(
      getServerInjectionSnapshotStore('tpc_b'),
    );
  });

  it('has no session key without a topic id', () => {
    expect(getServerInjectionSnapshotStore(undefined)).toBeUndefined();
  });

  it('bounds the registry and keeps the most recent sessions', () => {
    const oldest = getServerInjectionSnapshotStore('tpc_bound_0');
    const mostRecent = getServerInjectionSnapshotStore('tpc_bound_500');

    for (let index = 1; index < 500; index++) {
      getServerInjectionSnapshotStore(`tpc_bound_${index}`);
    }
    getServerInjectionSnapshotStore('tpc_bound_500');

    expect(getServerInjectionSnapshotStore('tpc_bound_0')).not.toBe(oldest);
    expect(getServerInjectionSnapshotStore('tpc_bound_500')).toBe(mostRecent);
  });

  it('expires sessions idle for longer than six hours', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-22T12:00:00Z'));

    const initial = getServerInjectionSnapshotStore('tpc_idle');

    vi.setSystemTime(new Date('2026-11-22T18:00:01Z'));
    // Any registry access runs eviction, even for another topic.
    getServerInjectionSnapshotStore('tpc_active');

    expect(getServerInjectionSnapshotStore('tpc_idle')).not.toBe(initial);
  });
});
