// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/server';
import { readArtifactObject } from '@/server/services/artifactDeployment';

import { resolveObjectPath, respondWithArtifact, SANDBOX_CSP } from './handler';

vi.mock('@/database/server', () => ({ getServerDB: vi.fn() }));

vi.mock('@/server/services/artifactDeployment', () => ({ readArtifactObject: vi.fn() }));

const db = {};
const ID = 'artifact-1';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getServerDB).mockResolvedValue(db as any);
});

const serve = (path: string) => respondWithArtifact(ID, path);

describe('resolveObjectPath', () => {
  it('sends an empty path to the deployment entry', () => {
    expect(resolveObjectPath(undefined)).toBe('');
    expect(resolveObjectPath([])).toBe('');
    expect(resolveObjectPath([''])).toBe('');
  });

  it('joins nested segments into an object key', () => {
    expect(resolveObjectPath(['assets', 'app.js'])).toBe('assets/app.js');
  });

  it('rejects traversal, including through an encoded separator', () => {
    expect(resolveObjectPath(['..', '..', 'secret'])).toBeNull();
    expect(resolveObjectPath(['a/../b'])).toBeNull();
    expect(resolveObjectPath(['.', 'x'])).toBeNull();
  });
});

describe('respondWithArtifact', () => {
  it('serves the entry HTML, sandboxed and un-cached', async () => {
    vi.mocked(readArtifactObject).mockResolvedValue({
      bytes: new TextEncoder().encode('<html>hi</html>'),
      contentType: 'text/html',
    } as any);

    const response = await serve('');

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('<html>hi</html>');
    expect(response.headers.get('content-type')).toBe('text/html');
    expect(response.headers.get('content-security-policy')).toBe(SANDBOX_CSP);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    // Without this the sandboxed page's module scripts are blocked as cross-origin.
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('cache-control')).toBe('no-cache');
    // An empty path is forwarded as-is: the service resolves the deployment's
    // own entry, so the route never has to know which file that is.
    expect(readArtifactObject).toHaveBeenCalledWith(db, ID, '');
  });

  it('revalidates the named entry file too', async () => {
    vi.mocked(readArtifactObject).mockResolvedValue({
      bytes: new Uint8Array([1]),
      contentType: 'text/html',
    } as any);

    const response = await serve('index.html');

    expect(response.headers.get('cache-control')).toBe('no-cache');
  });

  it('serves nested assets with a long-lived cache', async () => {
    vi.mocked(readArtifactObject).mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: 'text/javascript',
    } as any);

    const response = await serve('assets/app.js');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/javascript');
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(readArtifactObject).toHaveBeenCalledWith(db, ID, 'assets/app.js');
  });

  it('falls back to octet-stream when the manifest knows no type', async () => {
    vi.mocked(readArtifactObject).mockResolvedValue({
      bytes: new Uint8Array([1]),
      contentType: '',
    } as any);

    const response = await serve('assets/app.bin');

    expect(response.headers.get('content-type')).toBe('application/octet-stream');
  });

  it('answers 404 when the deployment has no such object', async () => {
    vi.mocked(readArtifactObject).mockResolvedValue(null);

    const response = await serve('missing.html');

    expect(response.status).toBe(404);
  });
});
