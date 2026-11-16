'use client';

import type { IEditor } from '@lobehub/editor';
import { toast } from '@lobehub/ui';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { asrService } from '@/services/asr';
import { useServerConfigStore } from '@/store/serverConfig';

import { BrowserAudioWorkletCapture, requestDictationMicrophone } from './audio';
import { type DictationCancelReason, RealtimeDictationClient } from './client';
import type { RealtimeAsrSessionResponse, RealtimeDictationSnapshot } from './contract';
import { RealtimeDictationError } from './contract';
import { LexicalDictationEditor } from './editor';
import { OneshotDictationClient } from './oneshotClient';
import { resolveAsrModel } from './resolveAsrModel';
import { createRealtimeAsrSession } from './service';

const createSocket = (url: string) => new WebSocket(url);
const FALLBACK_SNAPSHOT: RealtimeDictationSnapshot = { retryable: false, status: 'idle' };
const getFallbackSnapshot = () => FALLBACK_SNAPSHOT;
const subscribeFallback = () => () => undefined;

/** Public surface shared by the realtime and oneshot implementations. */
export interface DictationClient {
  cancel: (reason?: DictationCancelReason) => Promise<void>;
  dispose: () => Promise<void>;
  getSnapshot: () => RealtimeDictationSnapshot;
  prefetch: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  subscribe: (listener: () => void) => () => void;
}

// Codes that mean the realtime transport itself is unusable, while one-shot transcription —
// which goes through the tRPC `asr.transcribe` endpoint instead — can still work. `AUTH_FAILED`,
// `PROVIDER_BILLING_BLOCKED` and `SESSION_LIMIT_EXCEEDED` are deliberately absent: they reflect
// account-level conditions that would fail one-shot just as well.
const FALLBACK_CODES = new Set([
  'NETWORK_DISCONNECTED',
  'PROTOCOL_ERROR',
  'PROVIDER_NOT_CONFIGURED',
  'PROVIDER_UNAVAILABLE',
  'SESSION_CREATE_FAILED',
]);

export const shouldFallbackToOneshot = (error: unknown): boolean =>
  error instanceof RealtimeDictationError && FALLBACK_CODES.has(error.code);

export interface DictationProbeResult {
  fallback: boolean;
  probed: boolean;
  session?: RealtimeAsrSessionResponse;
}

/**
 * First stage of `auto`: ask the admission endpoint which transport is usable
 * before a press. It never constructs a socket; a successful session is reused
 * by the realtime client so prefetch costs no extra network round trip.
 */
export const probeRealtimeAdmission = async (
  createSession: (signal: AbortSignal) => Promise<unknown>,
  signal: AbortSignal,
): Promise<DictationProbeResult> => {
  try {
    const session = (await createSession(signal)) as RealtimeAsrSessionResponse;
    return { fallback: false, probed: true, session };
  } catch (error) {
    return { fallback: shouldFallbackToOneshot(error), probed: true };
  }
};

interface DictationClients {
  oneshot: OneshotDictationClient;
  realtime: RealtimeDictationClient;
}

/**
 * A stable handle that forwards to whichever implementation owns the current
 * dictation session. The UI never remounts when `auto` switches backends.
 */
const createClientHandle = (getActive: () => DictationClient | undefined): DictationClient => ({
  cancel: (...args) => getActive()?.cancel(...args) ?? Promise.resolve(),
  dispose: (...args) => getActive()?.dispose(...args) ?? Promise.resolve(),
  getSnapshot: () => getActive()?.getSnapshot() ?? FALLBACK_SNAPSHOT,
  prefetch: (...args) => getActive()?.prefetch(...args) ?? Promise.resolve(),
  start: (...args) => getActive()?.start(...args) ?? Promise.resolve(),
  stop: (...args) => getActive()?.stop(...args) ?? Promise.resolve(),
  subscribe: (listener) => {
    const unsubscribe = getActive()?.subscribe(listener);
    return () => {
      unsubscribe?.();
    };
  },
});

export const useDictation = (editor?: IEditor) => {
  const serverMode = useServerConfigStore((s) => s.serverConfig.voiceDictationMode ?? 'auto');
  const { t } = useTranslation('chat');
  const editorAdapter = useMemo(
    () => (editor ? new LexicalDictationEditor(editor) : undefined),
    [editor],
  );
  const probeRef = useRef<
    { promise: Promise<DictationProbeResult>; signal?: AbortController } | undefined
  >(undefined);
  const clients = useMemo<DictationClients | undefined>(() => {
    if (!editorAdapter) return undefined;

    const oneshot = new OneshotDictationClient({
      createCapture: BrowserAudioWorkletCapture.create,
      editor: editorAdapter,
      requestMicrophone: requestDictationMicrophone,
      resolveModel: resolveAsrModel,
      transcribe: async (input, signal) => (await asrService.transcribeAudio(input, signal)).text,
    });
    const realtime = new RealtimeDictationClient({
      createCapture: BrowserAudioWorkletCapture.create,
      createSession: async (signal) => {
        const probe = await probeRef.current?.promise;
        if (probe?.session) return probe.session;
        return createRealtimeAsrSession(signal);
      },
      createWebSocket: createSocket,
      editor: editorAdapter,
      requestMicrophone: requestDictationMicrophone,
    });
    return { oneshot, realtime };
  }, [editorAdapter]);

  // An `auto` decision survives the whole hover → press → stop lifecycle and
  // resets only when the deployment mode or editor changes.
  const [activeMode, setActiveMode] = useState(serverMode);
  useEffect(() => setActiveMode(serverMode), [serverMode, clients]);
  const fallbackNotified = useRef(false);
  useEffect(() => {
    fallbackNotified.current = false;
    return () => {
      probeRef.current?.signal?.abort();
      probeRef.current = undefined;
    };
  }, [activeMode, clients]);

  const active = useMemo(() => {
    if (!clients) return undefined;
    return activeMode === 'oneshot' ? clients.oneshot : clients.realtime;
  }, [activeMode, clients]);
  const activeRef = useRef<DictationClient | undefined>(active);
  activeRef.current = active;
  const client = useMemo(() => createClientHandle(() => activeRef.current), []);

  useEffect(
    () => () => {
      if (!clients) return;
      void clients.realtime.dispose();
      void clients.oneshot.dispose();
    },
    [clients],
  );

  const notifyFallback = useCallback(() => {
    if (fallbackNotified.current) return;
    fallbackNotified.current = true;
    toast.info(t('voiceDictation.fallbackToOneshot'));
  }, [t]);

  const wrappedClient = useMemo<DictationClient | undefined>(() => {
    if (!clients) return undefined;

    /**
     * Ask the admission endpoint once per lifecycle and share the answer between hover
     * and press. Touch devices and mobile never hover, so `auto` cannot rely on
     * `prefetch` having run — and `RealtimeDictationClient.start()` swallows its own
     * failures, which means a missing probe surfaces an error instead of a fallback.
     */
    const ensureProbe = () => {
      if (!probeRef.current?.promise) {
        const controller = new AbortController();
        probeRef.current = {
          promise: probeRealtimeAdmission(createRealtimeAsrSession, controller.signal),
          signal: controller,
        };
      }
      return probeRef.current.promise;
    };

    const switchToOneshot = async () => {
      await clients.realtime.dispose();
      activeRef.current = clients.oneshot;
      setActiveMode('oneshot');
      notifyFallback();
    };

    return {
      ...client,
      prefetch: async () => {
        const current = activeRef.current;
        if (!current || current === clients.oneshot) return;
        if (activeMode !== 'auto') {
          await current.prefetch();
          return;
        }
        const probe = await ensureProbe();
        if (probe.fallback && activeRef.current === current) {
          await switchToOneshot();
          return;
        }
        if (!probe.session) await current.prefetch();
      },
      start: async () => {
        const current = activeRef.current;
        if (!current) return;
        if (current === clients.oneshot || activeMode !== 'auto') {
          await current.start();
          return;
        }
        const probe = await ensureProbe();
        if (probe.fallback && activeRef.current === current) {
          await switchToOneshot();
          await clients.oneshot.start();
          return;
        }
        await current.start();
      },
    };
  }, [activeMode, client, clients, notifyFallback]);

  const snapshot = useSyncExternalStore(
    wrappedClient?.subscribe ?? subscribeFallback,
    wrappedClient?.getSnapshot ?? getFallbackSnapshot,
    getFallbackSnapshot,
  );

  return { client: wrappedClient, ...snapshot };
};
