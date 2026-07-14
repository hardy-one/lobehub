import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createLocalStorage = (initialValue?: string) => {
  const values = new Map<string, string>();
  if (initialValue) values.set('lobehub:source-client-id', initialValue);

  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
  };
};

describe('sourceClientId', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reuses a valid source client id from localStorage', async () => {
    const sourceClientId = '91a303c8-70b0-4e45-b05f-9df235574121';
    const localStorage = createLocalStorage(sourceClientId);
    vi.stubGlobal('localStorage', localStorage);
    const { getSourceClientId } = await import('./sourceClientId');

    expect(getSourceClientId()).toBe(sourceClientId);
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });

  it('persists one source client id across module instances', async () => {
    const localStorage = createLocalStorage();
    vi.stubGlobal('localStorage', localStorage);
    const firstModule = await import('./sourceClientId');
    const firstSourceClientId = firstModule.getSourceClientId();

    vi.resetModules();
    const secondModule = await import('./sourceClientId');

    expect(secondModule.getSourceClientId()).toBe(firstSourceClientId);
    expect(secondModule.parseSourceClientId(firstSourceClientId)).toBe(firstSourceClientId);
  });

  it('replaces an invalid stored value with a valid UUID', async () => {
    const localStorage = createLocalStorage('not-a-uuid');
    vi.stubGlobal('localStorage', localStorage);
    const { getSourceClientId, parseSourceClientId } = await import('./sourceClientId');

    const sourceClientId = getSourceClientId();

    expect(parseSourceClientId(sourceClientId)).toBe(sourceClientId);
    expect(localStorage.setItem).toHaveBeenCalledWith('lobehub:source-client-id', sourceClientId);
  });

  it('uses a stable process UUID when localStorage is unavailable', async () => {
    vi.stubGlobal('localStorage', undefined);
    const { getSourceClientId, parseSourceClientId } = await import('./sourceClientId');

    const firstSourceClientId = getSourceClientId();

    expect(getSourceClientId()).toBe(firstSourceClientId);
    expect(parseSourceClientId(firstSourceClientId)).toBe(firstSourceClientId);
  });

  it('rejects malformed UUID values', async () => {
    const { parseSourceClientId } = await import('./sourceClientId');

    expect(parseSourceClientId('00000000-0000-0000-0000-000000000000')).toBeUndefined();
    expect(parseSourceClientId('91a303c8-70b0-4e45-705f-9df235574121')).toBeUndefined();
    expect(parseSourceClientId('not-a-uuid')).toBeUndefined();
  });
});
