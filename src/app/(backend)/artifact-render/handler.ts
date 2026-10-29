import debug from 'debug';

import { getServerDB } from '@/database/server';
import { readArtifactObject } from '@/server/services/artifactDeployment';

const log = debug('lobe-artifact:render');

/** The file a request with no path of its own resolves to. */
export const DEFAULT_ENTRY = 'index.html';

// No `allow-same-origin`: the page is model-written content, so it must run in an
// opaque origin even though it is served from our own host.
export const SANDBOX_CSP =
  'sandbox allow-scripts allow-forms allow-modals allow-popups allow-downloads';

const RESPONSE_HEADERS_BASE = {
  // The page runs in an opaque origin (sandboxed without `allow-same-origin`), so
  // its module scripts arrive as cross-origin requests and are blocked without
  // this. Nothing here is credential-bearing, so the wildcard is the whole grant.
  'Access-Control-Allow-Origin': '*',
  'Content-Security-Policy': SANDBOX_CSP,
  'X-Content-Type-Options': 'nosniff',
};

/**
 * Segments that name the deployment's own entry file. Those are revalidated on
 * every visit because a publish moves what they point at; every other object is
 * addressed by revision and can be cached for good.
 */
export const isEntryPath = (path: string) => path === '' || path === DEFAULT_ENTRY;

/**
 * Resolve a request path to an object key, or `null` when it can leave the
 * deployment root. Catch-all segments arrive percent-decoded, so `%2f` smuggles
 * a `/` — and with it a `..` — inside what looks like a single segment.
 *
 * An empty path means "the entry file": the service resolves the deployment's own
 * default, so a bare deployment URL serves the page without any redirect.
 */
export const resolveObjectPath = (path: string[] | undefined): null | string => {
  const segments = (path ?? []).flatMap((segment) => segment.split('/'));

  if (segments.every((segment) => segment === '')) return '';

  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..'))
    return null;

  return segments.join('/');
};

/**
 * Serve one file of a published Artifact. The deployment id is the capability and
 * objects are private, so this route is the only way a browser reaches them.
 */
export const respondWithArtifact = async (id: string, objectPath: string): Promise<Response> => {
  const db = await getServerDB();
  const object = await readArtifactObject(db, id, objectPath);

  if (!object) {
    log('Artifact object not found: %s/%s', id, objectPath);

    return new Response('Not found', { status: 404 });
  }

  return new Response(object.bytes, {
    headers: {
      ...RESPONSE_HEADERS_BASE,
      'Cache-Control': isEntryPath(objectPath) ? 'no-cache' : 'public, max-age=31536000, immutable',
      'Content-Type': object.contentType || 'application/octet-stream',
    },
  });
};
