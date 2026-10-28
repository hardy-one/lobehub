// Browser-only: this module boots @codesandbox/nodebox inside a real iframe and reads
// `document`, so its build path cannot be unit tested — it is verified by a manual smoke
// run in a browser. The pure helpers it uses are covered by `__tests__/utils.test.ts`.

import { Nodebox } from '@codesandbox/nodebox';
import { buildReactArtifactProject } from '@lobechat/artifact-template';
import { errorMessageFrom } from '@lobechat/utils/error';

import {
  contentTypeForPath,
  DIST_DIR,
  DIST_INDEX_PATH,
  normalizeSitePath,
  splitLogChunk,
} from './utils';

export { contentTypeForPath, normalizeSitePath, splitLogChunk } from './utils';

export interface ArtifactSiteFile {
  bytes: Uint8Array;
  contentType: string;
  path: string;
}

export interface BuildArtifactSiteOptions {
  /** Build output, line by line, as it is printed. */
  onLog?: (line: string) => void;
  onPhase?: (phase: 'installing' | 'building' | 'reading') => void;
  /** Aborting tears the build iframe down. */
  signal?: AbortSignal;
  /** The artifact's React source, the same code the preview rendered. */
  source: string;
  title?: string;
}

export type ArtifactSiteBuildErrorKind = 'aborted' | 'commandFailed' | 'noOutput' | 'timeout';

export class ArtifactSiteBuildError extends Error {
  kind: ArtifactSiteBuildErrorKind;
  /** The last lines the build printed before it stopped, for the UI to show. */
  logs: string[] = [];

  constructor(kind: ArtifactSiteBuildErrorKind, message: string, cause?: unknown) {
    super(message);
    this.name = 'ArtifactSiteBuildError';
    this.kind = kind;
    this.cause = cause;
  }
}

// Nodebox boots the shell (which installs the template's dependencies, by far the slowest
// step) and only then runs `vite build` itself, which takes seconds.
const BUILD_TIMEOUT_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 1500;

/** Build output retained on a thrown error, to keep it readable in the UI. */
const LOG_TAIL_LIMIT = 50;

const CANCELLED_MESSAGE = 'The artifact site build was cancelled';

interface LogSink {
  /** Emit the final partial line, which no newline terminated. */
  flush: () => void;
  push: (chunk: string) => void;
  /** The most recent lines, for attaching to a failure. */
  tail: () => string[];
}

const createLogSink = (onLog?: (line: string) => void): LogSink => {
  const lines: string[] = [];
  let carry = '';

  const emit = (line: string) => {
    // Blank progress-bar lines would only pad the UI's log view.
    if (!line.trim()) return;
    lines.push(line);
    if (lines.length > LOG_TAIL_LIMIT) lines.shift();
    onLog?.(line);
  };

  return {
    flush: () => {
      const line = carry;
      carry = '';
      if (line) emit(line);
    },
    tail: () => [...lines],
    push: (chunk) => {
      const split = splitLogChunk(carry, chunk);
      carry = split.carry;
      for (const line of split.lines) emit(line);
    },
  };
};

/**
 * Resolve after `ms`, or as soon as `signal` aborts: a cancelled build should not wait
 * out the polling interval before it stops.
 */
const interruptibleSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });

/**
 * A promise that rejects as soon as the caller aborts, raced against every step so a
 * cancel takes effect mid-command instead of waiting for Nodebox to answer one.
 */
const createAbortRace = (signal?: AbortSignal) => {
  let unsubscribe: (() => void) | undefined;

  const promise = new Promise<never>((_, reject) => {
    if (!signal) return;
    const onAbort = () => reject(new ArtifactSiteBuildError('aborted', CANCELLED_MESSAGE));
    signal.addEventListener('abort', onAbort, { once: true });
    unsubscribe = () => signal.removeEventListener('abort', onAbort);
    if (signal.aborted) onAbort();
  });

  return { dispose: () => unsubscribe?.(), promise };
};

/**
 * A zero-size iframe keeps the runtime running; `display: none` would let the browser
 * throttle its timers and stall the build.
 */
const createHostIframe = () => {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('tabindex', '-1');
  iframe.style.cssText =
    'border:0;height:0;left:0;pointer-events:none;position:fixed;top:0;width:0;';
  return iframe;
};

/** Whether `path` is a file yet. Nodebox rejects the stat while it does not exist. */
const isFile = async (fs: Nodebox['fs'], path: string) => {
  try {
    return (await fs.stat(path)).type === 'file';
  } catch {
    return false;
  }
};

/**
 * The shell's `exit` event does not match the process Nodebox reports, so the output
 * appearing on disk is the completion signal.
 */
const waitForDistIndex = async (
  fs: Nodebox['fs'],
  { signal, throwIfAborted }: { signal?: AbortSignal; throwIfAborted: () => void },
) => {
  const deadline = Date.now() + BUILD_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (await isFile(fs, DIST_INDEX_PATH)) return;
    await interruptibleSleep(POLL_INTERVAL_MS, signal);
    throwIfAborted();
  }

  const minutes = Math.round(BUILD_TIMEOUT_MS / 60_000);
  throw new ArtifactSiteBuildError(
    'timeout',
    `vite build produced no ${DIST_INDEX_PATH} within ${minutes} minutes`,
  );
};

const collectDistFiles = async (fs: Nodebox['fs'], dir: string): Promise<ArtifactSiteFile[]> => {
  const entries = (await fs.readdir(dir)).sort();
  const files: ArtifactSiteFile[] = [];

  for (const entry of entries) {
    const path = `${dir}/${entry}`;
    if ((await fs.stat(path)).type === 'dir') {
      files.push(...(await collectDistFiles(fs, path)));
      continue;
    }

    files.push({
      bytes: await fs.readFile(path),
      contentType: contentTypeForPath(path),
      path: normalizeSitePath(path),
    });
  }

  return files;
};

/**
 * Build an artifact's source into a static site, with the same template and Vite config
 * the preview uses, so the published site is what the user previewed.
 *
 * The builder runs entirely in the browser: a Nodebox runtime is booted in a hidden
 * iframe, the project files are written into its filesystem, and `vite build` is invoked
 * as a bare binary — the sandbox has no npm, so no script runner is available.
 */
export const buildReactArtifactSite = async (
  options: BuildArtifactSiteOptions,
): Promise<{ files: ArtifactSiteFile[] }> => {
  const { source, title, onLog, onPhase, signal } = options;

  const sink = createLogSink(onLog);
  const throwIfAborted = () => {
    if (signal?.aborted) throw new ArtifactSiteBuildError('aborted', CANCELLED_MESSAGE);
  };

  const project = buildReactArtifactProject({ appCode: source, title });

  const abort = createAbortRace(signal);
  // A Nodebox call can stay pending for the whole dependency install, so every step
  // answers Cancel rather than only the polling loop.
  const step = <T>(work: Promise<T>) => Promise.race([work, abort.promise]);

  const iframe = createHostIframe();
  document.body.append(iframe);

  try {
    const nodebox = new Nodebox({ iframe });
    await step(nodebox.connect());
    await step(nodebox.fs.init(project.files));

    // Covers booting the shell and installing the template's dependencies, which start
    // inside `runCommand` and dominate the whole build.
    onPhase?.('installing');

    // One process per command: a ShellProcess refuses a second `runCommand`.
    const build = nodebox.shell.create();
    build.stdout.on('data', (chunk: string) => sink.push(chunk));
    build.stderr.on('data', (chunk: string) => sink.push(chunk));

    try {
      await step(build.runCommand('vite', ['build']));
    } catch (error) {
      // The abort race can raise here too; that error already says what happened.
      if (error instanceof ArtifactSiteBuildError) throw error;

      throw new ArtifactSiteBuildError(
        'commandFailed',
        `vite build could not run: ${errorMessageFrom(error) ?? 'unknown error'}`,
        error,
      );
    }

    onPhase?.('building');
    await waitForDistIndex(nodebox.fs, { signal, throwIfAborted });

    sink.flush();
    onPhase?.('reading');

    const files = await collectDistFiles(nodebox.fs, DIST_DIR);
    if (files.length === 0)
      throw new ArtifactSiteBuildError('noOutput', `vite build left ${DIST_DIR}/ empty`);

    return { files };
  } catch (error) {
    // Attach the log tail once, at the single failure boundary, so every failure carries
    // what the build printed before it stopped.
    const logs = sink.tail();
    if (error instanceof ArtifactSiteBuildError) {
      error.logs = logs;
      throw error;
    }

    const wrapped = new ArtifactSiteBuildError(
      'commandFailed',
      errorMessageFrom(error) ?? 'The artifact site build failed',
      error,
    );
    wrapped.logs = logs;
    throw wrapped;
  } finally {
    abort.dispose();
    // Removing the iframe tears the runtime down, including a shell still installing
    // when the caller aborted.
    iframe.remove();
  }
};
