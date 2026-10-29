// The DOM-free half of the artifact site builder: what the built files are called, how
// they are served, and how the build's output is split into lines. Kept out of
// `buildArtifactSite.ts` so it can be unit tested without booting Nodebox.

/** Where the template's `vite build` writes its output, as Nodebox resolves paths. */
export const DIST_DIR = 'dist';
export const DIST_INDEX_PATH = `${DIST_DIR}/index.html`;

const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

// Upload-served types are decided here and nowhere else, so the site's files and the
// responses that carry them cannot drift apart.
const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.mjs': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/** Extension of a path's last segment, or `''` when it has none. */
const extensionOf = (path: string): string => {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  // A leading dot is a hidden file's name, not an extension.
  return dot <= 0 ? '' : name.slice(dot);
};

/** The content type an uploaded site file is served with. */
export const contentTypeForPath = (path: string): string =>
  CONTENT_TYPES[extensionOf(path.toLowerCase())] ?? DEFAULT_CONTENT_TYPE;

/** A built file's path in the deployed site: no leading slash, no `dist/` prefix. */
export const normalizeSitePath = (path: string): string => {
  const relative = path.replaceAll('\\', '/').replace(/^(?:\.?\/)+/, '');
  return relative.startsWith(`${DIST_DIR}/`) ? relative.slice(DIST_DIR.length + 1) : relative;
};

/**
 * Split a raw stdout/stderr chunk into complete lines, carrying the trailing partial line
 * into the next call: Nodebox emits raw chunks, so a line often arrives in two pieces.
 */
export const splitLogChunk = (carry: string, chunk: string): { carry: string; lines: string[] } => {
  const parts = `${carry}${chunk}`.split(/\r?\n/);
  return { carry: parts.pop() ?? '', lines: parts };
};
