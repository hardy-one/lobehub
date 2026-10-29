import { describe, expect, it } from 'vitest';

import { contentTypeForPath, normalizeSitePath, splitLogChunk } from '../utils';

describe('contentTypeForPath', () => {
  it('serves each built file type with the type the browser needs', () => {
    // A wrong content type here makes the deployed site render a blank page, so
    // every extension the template can emit is pinned.
    expect(contentTypeForPath('index.html')).toBe('text/html; charset=utf-8');
    expect(contentTypeForPath('assets/index-abc123.js')).toBe(
      'application/javascript; charset=utf-8',
    );
    expect(contentTypeForPath('assets/chunk.mjs')).toBe('application/javascript; charset=utf-8');
    expect(contentTypeForPath('assets/index-abc123.css')).toBe('text/css; charset=utf-8');
    expect(contentTypeForPath('manifest.json')).toBe('application/json');
    expect(contentTypeForPath('logo.svg')).toBe('image/svg+xml');
    expect(contentTypeForPath('logo.png')).toBe('image/png');
    expect(contentTypeForPath('photo.jpg')).toBe('image/jpeg');
    expect(contentTypeForPath('photo.jpeg')).toBe('image/jpeg');
    expect(contentTypeForPath('anim.gif')).toBe('image/gif');
    expect(contentTypeForPath('shot.webp')).toBe('image/webp');
    expect(contentTypeForPath('font.woff')).toBe('font/woff');
    expect(contentTypeForPath('font.woff2')).toBe('font/woff2');
  });

  it('ignores the case of the extension', () => {
    expect(contentTypeForPath('assets/INDEX.JS')).toBe('application/javascript; charset=utf-8');
    expect(contentTypeForPath('logo.SVG')).toBe('image/svg+xml');
  });

  it('falls back to a generic binary type', () => {
    expect(contentTypeForPath('archive.tar.gz')).toBe('application/octet-stream');
    expect(contentTypeForPath('LICENSE')).toBe('application/octet-stream');
    // A leading dot names a hidden file, not an extension.
    expect(contentTypeForPath('.nojekyll')).toBe('application/octet-stream');
  });

  it('reads the extension of the last path segment only', () => {
    expect(contentTypeForPath('assets.d/index.html')).toBe('text/html; charset=utf-8');
    expect(contentTypeForPath('assets/index.html.js.css')).toBe('text/css; charset=utf-8');
  });
});

describe('normalizeSitePath', () => {
  it('strips the dist prefix so paths are relative to the site root', () => {
    expect(normalizeSitePath('dist/index.html')).toBe('index.html');
    expect(normalizeSitePath('dist/assets/index-abc123.js')).toBe('assets/index-abc123.js');
  });

  it('strips leading slashes and current-directory segments', () => {
    expect(normalizeSitePath('/dist/index.html')).toBe('index.html');
    expect(normalizeSitePath('./dist/index.html')).toBe('index.html');
    expect(normalizeSitePath('//index.html')).toBe('index.html');
    expect(normalizeSitePath('index.html')).toBe('index.html');
  });

  it('normalizes windows separators', () => {
    expect(normalizeSitePath('dist\\assets\\index-abc123.js')).toBe('assets/index-abc123.js');
  });

  it('only strips a leading dist segment', () => {
    expect(normalizeSitePath('dist/assets/dist/logo.svg')).toBe('assets/dist/logo.svg');
    expect(normalizeSitePath('distfiles/index.html')).toBe('distfiles/index.html');
  });
});

describe('splitLogChunk', () => {
  it('splits a chunk into its complete lines', () => {
    expect(splitLogChunk('', 'vite v4.2.0 building for production...\n')).toEqual({
      carry: '',
      lines: ['vite v4.2.0 building for production...'],
    });
  });

  it('holds the trailing partial line for the next chunk', () => {
    expect(splitLogChunk('', 'transforming\nrendering')).toEqual({
      carry: 'rendering',
      lines: ['transforming'],
    });
  });

  it('completes a line split across two chunks', () => {
    expect(splitLogChunk('rendering', ' chunks...\ndone\n')).toEqual({
      carry: '',
      lines: ['rendering chunks...', 'done'],
    });
  });

  it('handles carriage returns so progress rewrites do not merge lines', () => {
    expect(splitLogChunk('', 'a\r\nb\r\n')).toEqual({ carry: '', lines: ['a', 'b'] });
  });

  it('keeps an empty chunk from emitting a line', () => {
    expect(splitLogChunk('', '')).toEqual({ carry: '', lines: [] });
    expect(splitLogChunk('partial', '')).toEqual({ carry: 'partial', lines: [] });
  });
});
