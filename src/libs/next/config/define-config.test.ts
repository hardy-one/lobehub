import { describe, expect, it } from 'vitest';

import { defineConfig } from './define-config';
import { dockerCanvasTracingIncludes } from './dockerCanvasTracingIncludes';

describe('defineConfig', () => {
  it('disables Next.js agent rule injection', () => {
    expect(defineConfig({}).agentRules).toBe(false);
  });

  it('caches SPA and auth build artifacts', async () => {
    const headers = await defineConfig({}).headers?.();

    for (const source of ['/_spa/:path*', '/_spa-auth/:path*']) {
      expect(headers?.find((header) => header.source === source)?.headers).toContainEqual({
        key: 'Cache-Control',
        value:
          'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800, stale-if-error=86400, immutable',
      });
    }
  });
});

describe('dockerCanvasTracingIncludes', () => {
  it('keeps Docker canvas tracing away from pnpm symlink directories', () => {
    expect(dockerCanvasTracingIncludes).toContain('node_modules/@napi-rs/canvas/**/*');
    expect(dockerCanvasTracingIncludes).toContain('node_modules/@napi-rs/canvas-*/package.json');
    expect(dockerCanvasTracingIncludes).toContain('node_modules/@napi-rs/canvas-*/*.node');
    expect(dockerCanvasTracingIncludes).toContain(
      'node_modules/.pnpm/@napi-rs+canvas-*/node_modules/@napi-rs/canvas-*/package.json',
    );
    expect(dockerCanvasTracingIncludes).toContain(
      'node_modules/.pnpm/@napi-rs+canvas-*/node_modules/@napi-rs/canvas-*/*.node',
    );
    expect(dockerCanvasTracingIncludes).not.toContain('node_modules/@napi-rs/canvas-*/**/*');
    expect(dockerCanvasTracingIncludes).not.toContain('node_modules/.pnpm/@napi-rs+canvas*/**/*');
    expect(dockerCanvasTracingIncludes).not.toContain('node_modules/.pnpm/@napi-rs+canvas-*/**/*');
  });
});
