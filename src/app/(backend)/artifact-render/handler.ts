import debug from 'debug';

import { getServerDB } from '@/database/server';
import { readArtifactObject } from '@/server/services/artifactDeployment';

const log = debug('lobe-artifact:render');

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

const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

/**
 * Whether a response may be cached for a year. HTML documents are served from
 * stable, non-content-addressed URLs: the entry (whatever file name the publish
 * used) and any page linked from it move on every redeploy, so they must be
 * revalidated. Every other object is a static asset, which a build names after
 * its content and can therefore keep for good.
 */
export const isImmutableAsset = (object: { contentType: string; isEntry: boolean }) =>
  !object.isEntry && !object.contentType.toLowerCase().startsWith('text/html');

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
      'Cache-Control': isImmutableAsset(object) ? IMMUTABLE_CACHE : 'no-cache',
      'Content-Type': object.contentType || 'application/octet-stream',
    },
  });
};
