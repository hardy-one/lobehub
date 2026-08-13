import { describe, expect, it } from 'vitest';

import { resolveCompressionMode } from './chatConfig';

type CompressionInput = {
  compression?: 'off' | 'standard' | 'smart';
  enableContextCompression?: boolean;
};

/**
 * Input matrix shared by the server runtime, the client runtime and the
 * settings UI. Both legacy semantics must agree on every entry:
 * - server-side enabled formula: `compression !== undefined ? compression !== 'off' : (enableContextCompression ?? true)`
 * - UI mode formula:             `compression ?? (enableContextCompression === false ? 'off' : 'standard')`
 */
const MATRIX: (CompressionInput | undefined | null)[] = [
  { compression: 'off' },
  { compression: 'standard' },
  { compression: 'smart' },
  // An explicit mode supersedes the legacy toggle.
  { compression: 'off', enableContextCompression: true },
  { compression: 'standard', enableContextCompression: false },
  { compression: 'smart', enableContextCompression: false },
  // Legacy toggle only (configs persisted before `compression` existed).
  { enableContextCompression: false },
  { enableContextCompression: true },
  {},
  undefined,
  null,
];

describe('resolveCompressionMode', () => {
  it.each(MATRIX)('resolves %j to the expected mode', (input) => {
    // Explicit `compression` wins; otherwise `enableContextCompression === false`
    // maps to 'off' and everything else (true / undefined) falls back to 'standard'.
    const compression = input?.compression;
    const legacy = input?.enableContextCompression;
    const expected = compression ?? (legacy === false ? 'off' : 'standard');
    expect(resolveCompressionMode(input)).toBe(expected);
  });

  it('keeps client and server semantics in parity across the whole matrix', () => {
    for (const input of MATRIX) {
      const compression = input?.compression;
      const legacy = input?.enableContextCompression;

      // Server-side enabled flag derived from the shared mode.
      const enabled = resolveCompressionMode(input) !== 'off';
      const legacyServerEnabled =
        compression !== undefined ? compression !== 'off' : (legacy ?? true);
      expect(enabled, `enabled parity for ${JSON.stringify(input)}`).toBe(legacyServerEnabled);

      // UI-side mode selection derived from the shared mode.
      const legacyUiMode = compression ?? (legacy === false ? 'off' : 'standard');
      expect(resolveCompressionMode(input), `mode parity for ${JSON.stringify(input)}`).toBe(
        legacyUiMode,
      );
    }
  });
});
