import { type RealtimeAudioCapture, stopMediaStream } from './audio';
import type { DictationCancelReason } from './client';
import { toClientError } from './clientErrors';
import {
  REALTIME_ASR_LIMITS,
  RealtimeDictationError,
  type RealtimeDictationErrorCode,
  type RealtimeDictationSnapshot,
} from './contract';
import type { DictationEditorAdapter } from './editor';
import { encodePcm16FramesToWav } from './wav';

export interface OneshotDictationDependencies {
  createCapture: (stream: MediaStream) => Promise<RealtimeAudioCapture>;
  editor: DictationEditorAdapter;
  requestMicrophone: () => Promise<MediaStream>;
  resolveModel: () => { model: string; provider: string }; // 取不到时抛错
  transcribe: (
    input: {
      audioBase64: string;
      fileName: string;
      mimeType: string;
      model: string;
      provider: string;
    },
    signal?: AbortSignal,
  ) => Promise<string>;
}

const IDLE_SNAPSHOT: RealtimeDictationSnapshot = {
  retryable: false,
  status: 'idle',
};

const MAX_WAV_BYTES = 3 * 1024 * 1024;
const ONESHOT_FILE_NAME = 'dictation.wav';
const ONESHOT_MIME_TYPE = 'audio/wav';

const DEFAULT_MAX_RECORDING_MS = REALTIME_ASR_LIMITS.maxSessionMs;

export class OneshotDictationClient {
  readonly #dependencies: OneshotDictationDependencies;
  readonly #subscribers = new Set<() => void>();
  #abortController?: AbortController;
  #acceptingAudio = false;
  #capture?: RealtimeAudioCapture;
  #editorFinalized = false;
  readonly #maxRecordingMs: number;
  #microphoneStream?: MediaStream;
  #pendingFrames: ArrayBuffer[] = [];
  #recordingTimer?: ReturnType<typeof setTimeout>;
  #runId = 0;
  #snapshot = IDLE_SNAPSHOT;
  #terminalTransition = false;

  constructor(
    dependencies: OneshotDictationDependencies,
    options: { maxRecordingMs?: number } = {},
  ) {
    this.#dependencies = dependencies;
    this.#maxRecordingMs = options.maxRecordingMs ?? DEFAULT_MAX_RECORDING_MS;
  }

  getSnapshot = () => this.#snapshot;

  subscribe = (listener: () => void) => {
    this.#subscribers.add(listener);
    return () => this.#subscribers.delete(listener);
  };

  /**
   * Oneshot transcription has no handshake, socket, or model warmup to prepare.
   * Kept for interface parity with `RealtimeDictationClient`; must stay a no-op.
   */
  async prefetch(): Promise<void> {
    return;
  }

  async start(): Promise<void> {
    if (this.#snapshot.status !== 'idle' && this.#snapshot.status !== 'error') return;

    await this.#releaseResources();
    const runId = ++this.#runId;
    this.#editorFinalized = false;
    this.#terminalTransition = false;
    this.#acceptingAudio = false;
    this.#pendingFrames = [];

    const anchor = this.#dependencies.editor.begin(() => {
      void this.cancel('audio_interruption');
    });
    if (!anchor) {
      this.#setError('AUDIO_CAPTURE_FAILED', true);
      return;
    }

    this.#setSnapshot({ retryable: false, status: 'requesting_permission' });
    const abortController = new AbortController();
    this.#abortController = abortController;

    try {
      const stream = await this.#dependencies.requestMicrophone();
      if (runId !== this.#runId) {
        stopMediaStream(stream);
        return;
      }
      this.#microphoneStream = stream;

      const capture = await this.#dependencies.createCapture(stream);
      if (runId !== this.#runId) {
        await capture.cancel().catch(() => undefined);
        return;
      }
      this.#capture = capture;
      // Accept frames before `capture.start()` resolves: the worklet may
      // deliver the first 200-400ms before its start promise settles.
      this.#acceptingAudio = true;

      await capture.start(this.#handleAudioFrame, () => {
        void this.#fail('AUDIO_CAPTURE_FAILED', true);
      });
      if (runId !== this.#runId) return;

      this.#setSnapshot({ retryable: false, status: 'listening' });
      // The capture layer owns the upper bound too; this timer guarantees the
      // oneshot client stops and transcribes at maxSessionMs even if the caller
      // never invokes stop(), matching realtime's session limit.
      this.#recordingTimer = setTimeout(() => {
        void this.stop();
      }, this.#maxRecordingMs);
    } catch (error) {
      if (runId !== this.#runId) return;
      const clientError = toClientError(error);
      await this.#fail(clientError.code, clientError.retryable);
    }
  }

  async stop(): Promise<void> {
    if (this.#snapshot.status !== 'listening') return;
    const runId = this.#runId;

    this.#acceptingAudio = false;
    this.#clearRecordingTimer();
    this.#setSnapshot({ retryable: false, status: 'finalizing' });

    try {
      await this.#capture?.stop();
      if (runId !== this.#runId) return;

      const wav = encodePcm16FramesToWav(this.#pendingFrames);
      if (wav.size > MAX_WAV_BYTES) {
        throw new RealtimeDictationError('AUDIO_FORMAT_INVALID', false);
      }
      const audioBase64 = await encodeBlobToBase64(wav);
      if (runId !== this.#runId) return;

      const { model, provider } = this.#dependencies.resolveModel();
      const text = await this.#dependencies.transcribe(
        {
          audioBase64,
          fileName: ONESHOT_FILE_NAME,
          mimeType: ONESHOT_MIME_TYPE,
          model,
          provider,
        },
        this.#abortController?.signal,
      );
      if (runId !== this.#runId) return;

      this.#dependencies.editor.finalize(text);
      this.#editorFinalized = true;
      await this.#complete();
    } catch (error) {
      if (runId !== this.#runId) return;
      const clientError = toClientError(error);
      await this.#fail(clientError.code, clientError.retryable);
    }
  }

  async cancel(reason: DictationCancelReason = 'user_cancelled'): Promise<void> {
    void reason; // oneshot has no remote session to tag with a cancel reason
    const status = this.#snapshot.status;
    if (status === 'idle') return;

    ++this.#runId;
    this.#acceptingAudio = false;
    this.#clearRecordingTimer();
    this.#abortController?.abort();
    this.#pendingFrames = [];
    await this.#capture?.cancel().catch(() => undefined);
    this.#discardEditor();
    await this.#releaseResources();
    this.#setSnapshot(IDLE_SNAPSHOT);
  }

  async dispose(): Promise<void> {
    ++this.#runId;
    this.#acceptingAudio = false;
    this.#clearRecordingTimer();
    this.#abortController?.abort();
    this.#discardEditor();
    await this.#releaseResources();
    this.#setSnapshot(IDLE_SNAPSHOT);
  }

  #handleAudioFrame = (frame: ArrayBuffer) => {
    if (!this.#acceptingAudio) return;
    this.#pendingFrames.push(frame);
  };

  #clearRecordingTimer() {
    if (this.#recordingTimer) clearTimeout(this.#recordingTimer);
    this.#recordingTimer = undefined;
  }

  #discardEditor() {
    if (this.#editorFinalized) return;
    this.#editorFinalized = true;
    // The shared adapter has no partial text to discard for oneshot (no render calls),
    // but invoke the hook when the injected adapter provides it, per the cancel contract.
    (
      this.#dependencies.editor as DictationEditorAdapter & { discardPartial?: () => void }
    ).discardPartial?.();
    this.#dependencies.editor.finalize('');
  }

  async #fail(code: RealtimeDictationErrorCode, retryable: boolean) {
    if (this.#terminalTransition) return;
    this.#terminalTransition = true;
    ++this.#runId;
    this.#discardEditor();
    await this.#releaseResources();
    this.#setError(code, retryable);
  }

  async #complete() {
    if (this.#terminalTransition) return;
    this.#terminalTransition = true;
    ++this.#runId;
    await this.#releaseResources();
    this.#setSnapshot(IDLE_SNAPSHOT);
  }

  async #releaseResources() {
    this.#acceptingAudio = false;
    this.#clearRecordingTimer();
    this.#abortController?.abort();
    this.#abortController = undefined;
    this.#pendingFrames = [];
    if (this.#microphoneStream) stopMediaStream(this.#microphoneStream);
    this.#microphoneStream = undefined;
    await this.#capture?.cancel().catch(() => undefined);
    this.#capture = undefined;
  }

  #setError(code: RealtimeDictationErrorCode, retryable: boolean) {
    this.#setSnapshot({ errorCode: code, retryable, status: 'error' });
  }

  #setSnapshot(snapshot: RealtimeDictationSnapshot) {
    this.#snapshot = snapshot;
    for (const subscriber of this.#subscribers) subscriber();
  }
}

/** Base64 without one giant string concatenation: FileReader streams the Blob internally. */
const encodeBlobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('base64_encode_failed'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('base64_encode_failed'));
        return;
      }
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(blob);
  });
