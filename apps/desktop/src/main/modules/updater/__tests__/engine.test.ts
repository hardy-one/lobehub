import type { SparkleBridge } from 'electron-sparkle-updater';
import { describe, expect, it, vi } from 'vitest';

import {
  createUpdateEngine as createSharedEngine,
  resolveUpdateEngineKind as resolveSharedKind,
} from '../engine';
import {
  createUpdateEngine as createMacEngine,
  resolveUpdateEngineKind as resolveMacKind,
} from '../engine.mac';

const { mockLoadBridge } = vi.hoisted(() => ({ mockLoadBridge: vi.fn() }));

vi.mock('electron-sparkle-updater', () => ({ loadSparkleBridge: mockLoadBridge }));

vi.mock('electron', () => ({
  app: { getVersion: () => '1.0.0', isPackaged: true, on: vi.fn() },
}));

vi.mock('electron-log', () => ({ default: { transports: { file: { level: 'info' } } } }));

vi.mock('electron-updater', () => ({ autoUpdater: {} }));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

// The macOS module reads the release host at build time; pin it so the appcast
// URL is assertable, and keep the rest of the real config module.
vi.mock('../configs', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  UPDATE_SERVER_URL: 'https://releases.example.com',
}));

const createBridge = (): SparkleBridge =>
  ({
    checkForUpdates: vi.fn(),
    discardDownloadedUpdate: vi.fn(),
    init: vi.fn().mockReturnValue(true),
    installUpdateNow: vi.fn(),
    installUpdateOnQuit: vi.fn(),
    setAutomaticChecks: vi.fn(),
    setEventHandler: vi.fn(),
  }) as unknown as SparkleBridge;

describe('macOS updater engine selection', () => {
  it.each(['stable', 'canary'] as const)('serves %s from a Sparkle appcast', async (channel) => {
    const bridge = createBridge();
    mockLoadBridge.mockReturnValue(bridge);

    const engine = await createMacEngine(channel);

    expect(resolveMacKind(channel)).toBe('sparkle');
    expect(engine.kind).toBe('sparkle');
    expect(bridge.init).toHaveBeenCalledWith({
      appcastUrl: `https://releases.example.com/${channel}/appcast-${process.arch}.xml`,
    });
  });

  // HARDY ships as GitHub releases, so it must never reach the Sparkle engine:
  // `{UPDATE_SERVER_URL}/HARDY/appcast-*.xml` is not published by any workflow.
  it('serves HARDY from electron-updater and never builds a Sparkle engine', async () => {
    const bridge = createBridge();
    mockLoadBridge.mockReturnValue(bridge);

    const engine = await createMacEngine('HARDY');

    expect(resolveMacKind('HARDY')).toBe('electron-updater');
    expect(engine.kind).toBe('electron-updater');
    expect(mockLoadBridge).not.toHaveBeenCalled();
    expect(bridge.init).not.toHaveBeenCalled();
  });

  it('keeps every channel on electron-updater outside macOS', async () => {
    expect(resolveSharedKind('stable')).toBe('electron-updater');
    expect(resolveSharedKind('canary')).toBe('electron-updater');

    for (const channel of ['stable', 'canary', 'HARDY'] as const) {
      expect((await createSharedEngine(channel)).kind).toBe('electron-updater');
    }
    expect(mockLoadBridge).not.toHaveBeenCalled();
  });
});
