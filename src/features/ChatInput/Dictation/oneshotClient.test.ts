import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RealtimeAudioCapture } from './audio';
import type { DictationCancelReason } from './client';
import type { DictationEditorAdapter } from './editor';
import { OneshotDictationClient, type OneshotDictationDependencies } from './oneshotClient';

// Stub FileReader so base64 encoding settles in a microtask. Happy-dom's real
// FileReader uses macrotasks that fake timers cannot drive.
vi.stubGlobal(
  'FileReader',
  class {
    result: string | ArrayBuffer | null = null;
    error: Error | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsDataURL(blob: Blob) {
      // The production code only needs the data URL prefix and base64 body.
      queueMicrotask(() => {
        const bytes = new Uint8Array(blob.size);
        this.result = `data:${blob.type};base64,${btoa(String.fromCharCode(...bytes))}`;
        this.onload?.();
      });
    }
  },
);
afterAll(() => vi.unstubAllGlobals());
type TestEditor = DictationEditorAdapter & { discardPartial: ReturnType<typeof vi.fn> };
type TestCapture = RealtimeAudioCapture & { emit: (frame: ArrayBuffer) => void };
type TestStream = MediaStream & { track: { stop: ReturnType<typeof vi.fn> } };

const stream = (): TestStream => {
  const track = { stop: vi.fn() };
  return { getTracks: () => [track], track } as unknown as TestStream;
};

const capture = (): TestCapture => {
  let onFrame: ((frame: ArrayBuffer) => void) | undefined;
  return {
    cancel: vi.fn().mockResolvedValue(undefined),
    start: vi.fn(async (frameHandler: (frame: ArrayBuffer) => void) => {
      onFrame = frameHandler;
    }),
    stop: vi.fn().mockResolvedValue(undefined),
    emit: (frame: ArrayBuffer) => onFrame?.(frame),
  };
};

const editor = (): TestEditor => ({
  begin: vi.fn(() => ({ anchor: 0, prefix: '', suffix: '' })),
  discardPartial: vi.fn(),
  dispose: vi.fn(),
  finalize: vi.fn(),
  render: vi.fn(),
});

const frame = (value = 1): ArrayBuffer => {
  const buffer = new ArrayBuffer(2);
  new DataView(buffer).setInt16(0, value, true);
  return buffer;
};

const makeClient = (
  overrides: Partial<OneshotDictationDependencies> = {},
  options: { maxRecordingMs?: number } = {},
) => {
  const micStream = stream();
  const cap = capture();
  const ed = editor();
  const transcribe = vi.fn().mockResolvedValue('转写结果');
  const dependencies: OneshotDictationDependencies = {
    createCapture: vi.fn().mockResolvedValue(cap),
    editor: ed,
    requestMicrophone: vi.fn().mockResolvedValue(micStream),
    resolveModel: vi.fn(() => ({ model: 'model-x', provider: 'provider-y' })),
    transcribe,
    ...overrides,
  };
  const client = new OneshotDictationClient(dependencies, options);
  return { cap, client, dependencies, ed, micStream, transcribe };
};

const statuses = (client: OneshotDictationClient) => {
  const seen: string[] = [];
  const unsubscribe = client.subscribe(() => seen.push(client.getSnapshot().status));
  return { seen, unsubscribe };
};

const flush = async (times = 6) => {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
};

const waitFor = async (predicate: () => boolean) => {
  for (let index = 0; index < 20 && !predicate(); index += 1) await flush();
  return predicate();
};

describe('OneshotDictationClient', () => {
  describe('shape and prefetch', () => {
    it('exposes the same public surface as RealtimeDictationClient', () => {
      const { client } = makeClient();
      for (const method of [
        'subscribe',
        'getSnapshot',
        'prefetch',
        'start',
        'stop',
        'cancel',
        'dispose',
      ] as const) {
        expect(typeof client[method]).toBe('function');
      }
      expect(client.getSnapshot()).toEqual({ retryable: false, status: 'idle' });
    });

    it('prefetch is a no-op: no mic, capture, model resolution, or transcription', async () => {
      const { client, dependencies } = makeClient();
      await client.prefetch();
      expect(dependencies.requestMicrophone).not.toHaveBeenCalled();
      expect(dependencies.createCapture).not.toHaveBeenCalled();
      expect(dependencies.resolveModel).not.toHaveBeenCalled();
      expect(dependencies.transcribe).not.toHaveBeenCalled();
      expect(client.getSnapshot().status).toBe('idle');
    });
  });

  describe('five-state machine', () => {
    it('transitions idle → requesting_permission → listening → finalizing → idle', async () => {
      const { client, transcribe, ed } = makeClient();
      const track = statuses(client);

      await client.start();
      expect(client.getSnapshot().status).toBe('listening');
      expect(ed.render).not.toHaveBeenCalled(); // no partial text while listening

      await client.stop();
      expect(client.getSnapshot().status).toBe('idle');
      expect(track.seen).toEqual(['requesting_permission', 'listening', 'finalizing', 'idle']);
      expect(transcribe).toHaveBeenCalledTimes(1);
      expect(ed.finalize).toHaveBeenCalledWith('转写结果');
      track.unsubscribe();
    });

    it('moves to error with a code when any stage fails', async () => {
      const { client } = makeClient({
        transcribe: vi.fn().mockRejectedValue(new Error('boom')),
      });
      await client.start();
      await client.stop();
      expect(client.getSnapshot()).toMatchObject({
        errorCode: 'AUDIO_CAPTURE_FAILED',
        retryable: true,
        status: 'error',
      });
    });
  });

  describe('early audio frames', () => {
    it('keeps frames delivered before capture.start() resolves', async () => {
      let resolveStart!: () => void;
      const early = frame(17);
      const cap: TestCapture = {
        cancel: vi.fn().mockResolvedValue(undefined),
        start: vi.fn((handler: (frame: ArrayBuffer) => void) => {
          // Worklet delivers a frame before the start promise settles.
          handler(early);
          return new Promise<void>((resolve) => {
            resolveStart = resolve;
          });
        }),
        stop: vi.fn().mockResolvedValue(undefined),
        emit: () => undefined,
      };
      let audioBytes = 0;
      const transcribe = vi.fn((input: { audioBase64: string }) => {
        // Decode instead of estimating from the base64 length: padding makes that
        // estimate up to 2 bytes too large for a short payload.
        audioBytes = atob(input.audioBase64).length - 44;
        return Promise.resolve('ok');
      });
      const { client } = makeClient({
        createCapture: vi.fn().mockResolvedValue(cap),
        transcribe,
      });

      const starting = client.start();
      await vi.waitFor(() => expect(resolveStart).toBeDefined());
      resolveStart();
      await starting;
      await client.stop();

      expect(transcribe).toHaveBeenCalledTimes(1);
      expect(audioBytes).toBe(early.byteLength);
    });
  });

  describe('cancel', () => {
    it('discards buffered frames, aborts and leaves no editor text when listening', async () => {
      const { client, cap, ed, transcribe, micStream } = makeClient();
      await client.start();
      cap.emit(frame(1));
      cap.emit(frame(2));

      await client.cancel('user_cancelled');

      expect(client.getSnapshot()).toEqual({ retryable: false, status: 'idle' });
      expect(ed.discardPartial).toHaveBeenCalledTimes(1);
      expect(ed.finalize).toHaveBeenCalledWith('');
      expect(ed.render).not.toHaveBeenCalled();
      expect(cap.cancel).toHaveBeenCalled();
      expect(micStream.track.stop).toHaveBeenCalled();
      expect(transcribe).not.toHaveBeenCalled();
    });

    it('cancels while finalizing and drops a late transcription result', async () => {
      let resolveTranscribe: ((text: string) => void) | undefined;
      const transcribe = vi.fn(
        () =>
          new Promise<string>((resolve) => {
            resolveTranscribe = resolve;
          }),
      );
      const { client, ed } = makeClient({ transcribe });
      await client.start();
      const stopPromise = client.stop();
      expect(client.getSnapshot().status).toBe('finalizing');

      await client.cancel('network_change');
      expect(client.getSnapshot().status).toBe('idle');
      expect(ed.finalize).toHaveBeenCalledWith('');
      resolveTranscribe?.('迟到的文本');
      await stopPromise;

      expect(ed.finalize).not.toHaveBeenCalledWith('迟到的文本');
      expect(client.getSnapshot().status).toBe('idle');
    });

    it('passes an AbortSignal to transcribe and aborts it on cancel', async () => {
      let signal: AbortSignal | undefined;
      const transcribe = vi.fn(
        (_input: unknown, s?: AbortSignal) =>
          new Promise<string>((_resolve, reject) => {
            signal = s;
            s?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      );
      const { client } = makeClient({ transcribe });
      await client.start();
      const stopPromise = client.stop();
      expect(await waitFor(() => signal !== undefined)).toBe(true);
      expect(signal?.aborted).toBe(false);
      await client.cancel();
      expect(signal?.aborted).toBe(true);
      await stopPromise;
    });
  });

  describe('limits', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('auto-stops at 60s and submits the buffered audio normally', async () => {
      const { client, cap, transcribe, ed } = makeClient({}, { maxRecordingMs: 60_000 });
      await client.start();
      cap.emit(frame(12));
      await vi.advanceTimersByTimeAsync(60_000);
      expect(await waitFor(() => transcribe.mock.calls.length === 1)).toBe(true);

      expect(transcribe).toHaveBeenCalledTimes(1);
      expect(client.getSnapshot().status).toBe('idle');
      expect(ed.finalize).toHaveBeenCalledWith('转写结果');
      const input = transcribe.mock.calls[0][0];
      expect(input.mimeType).toBe('audio/wav');
      expect(input.fileName).toBe('dictation.wav');
      expect(input.audioBase64.length).toBeGreaterThan(0);
      expect(input.model).toBe('model-x');
      expect(input.provider).toBe('provider-y');
    });

    it('rejects WAV output over 3MB with an explicit error code', async () => {
      const { client, cap, transcribe, ed } = makeClient();
      await client.start();
      // 3MiB + 1 byte of raw s16le plus the 44-byte header exceeds the 3MiB cap.
      cap.emit(new ArrayBuffer(3 * 1024 * 1024 + 1));
      await client.stop();

      expect(client.getSnapshot().errorCode).toBe('AUDIO_FORMAT_INVALID');
      expect(transcribe).not.toHaveBeenCalled();
      expect(ed.discardPartial).toHaveBeenCalledTimes(1);
      expect(ed.finalize).toHaveBeenCalledWith('');
    });
  });

  describe('cancel reason type', () => {
    it('accepts all realtime cancel reasons', async () => {
      const reasons: DictationCancelReason[] = [
        'audio_interruption',
        'network_change',
        'user_cancelled',
      ];
      for (const reason of reasons) {
        const { client } = makeClient();
        await client.start();
        await expect(client.cancel(reason)).resolves.toBeUndefined();
      }
    });
  });
});
