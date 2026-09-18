import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';

import { AgentStreamPipeline, type UploadHeterogeneousImage } from '../spawn/agentStreamPipeline';
import type { HeterogeneousAgentRuntimeStatus } from '../spawn/claudeAgentSdkSession';
import { PiRpcClient, PiRpcConnectionError, PiRpcResponseError } from './piRpcClient';
import { PiOperationContextUnavailableError } from './piRpcOperationContext';
import {
  PI_RPC_ABORT_TIMEOUT_MS,
  type PiExtensionUiRequest,
  type PiExtensionUiResponse,
  type PiMessageEndEvent,
  type PiMessageUpdateEvent,
  type PiRpcCommand,
  type PiRpcEvent,
  type PiRpcImage,
  type PiSessionEvent,
} from './piRpcProtocol';

/** Text + base64 image content for a single prompt. */
export interface PiRpcPromptInput {
  images?: PiRpcImage[];
  text: string;
}

export interface PiRpcSessionOptions {
  /** Extra CLI args (user/provider-configured), e.g. `--provider`, `--model`. */
  args: string[];
  /**
   * When true (default), `run()` recycles its process once the run settles
   * (per-run lifecycle — one run owns one process). When false, the process
   * survives the run so the host can reuse it for follow-up turns; the host
   * owns `close()` (e.g. an idle reaper). `run()` stays re-entrant: call it
   * again for the next turn on the same session.
   */
  autoCloseOnSettle?: boolean;
  /** Absolute (or resolved) path to the `pi` executable. */
  commandPath: string;
  cwd: string;
  detached?: boolean;
  env: NodeJS.ProcessEnv;
  /** How long a run may go without any event before it is considered stale. */
  inactivityTimeoutMs?: number;
  onEvents: (events: AgentStreamEvent[]) => void | Promise<void>;
  /** Extension UI dialogs — return a response to answer, or `undefined` to cancel. */
  onExtensionUiRequest?: (
    request: PiExtensionUiRequest,
  ) => Promise<PiExtensionUiResponse | undefined> | PiExtensionUiResponse | undefined;
  /**
   * Cross-end timing hook (absolute timestamps are added by the caller). The
   * host uses it to separate "pi finished answering" from "pi told us it
   * settled" from "we tore the process down".
   */
  onPhase?: (phase: string, detail?: Record<string, unknown>) => void;
  onRawStdout?: (chunk: Buffer) => void;
  onRuntimeStatus: (status: HeterogeneousAgentRuntimeStatus) => void;
  /** Freshest native pi session id (RPC mode: from the get_state handshake). */
  onSessionId: (sessionId: string) => void;
  onStderr: (data: string) => void | Promise<void>;
  /** Renderer-side operation id stamped onto every emitted event. */
  operationId: string;
  /** Native pi session id to resume (`--session-id <id>` at spawn). */
  resumeSessionId?: string;
  /** LobeHub session id — used for runtime status and diagnostics only. */
  sessionId: string;
  /** Effective child-visible identity, including user env overrides. null deletes it. */
  shellOperationId?: string | null;
  /** Uploader for base64 tool_result images (see `AgentStreamPipelineOptions`). */
  uploadImage?: UploadHeterogeneousImage;
}

/** Host callbacks a pooled process can be rebound to between runs. */
export interface PiRpcSessionCallbacks {
  onEvents: (events: AgentStreamEvent[]) => void | Promise<void>;
  onRuntimeStatus: (status: HeterogeneousAgentRuntimeStatus) => void;
  onSessionId: (sessionId: string) => void;
  onStderr: (data: string) => void | Promise<void>;
  operationId: string;
  sessionId: string;
  shellOperationId?: string | null;
}

const DEFAULT_INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;
const ABORTED_REASON = 'aborted';

const isTerminalAbortedEvent = (event: PiRpcEvent): boolean => {
  if (event.type === 'message_update') {
    const update = (event as PiMessageUpdateEvent).assistantMessageEvent;
    if (update?.type !== 'error') return false;
    return update.reason === ABORTED_REASON || update.error?.stopReason === ABORTED_REASON;
  }
  if (event.type === 'message_end') {
    const message = (event as PiMessageEndEvent).message;
    return message?.stopReason === ABORTED_REASON;
  }
  return false;
};

/**
 * One Pi RPC process, optionally reused across sequential prompt runs.
 * AgentStreamPipeline owns retry/error semantics; only agent_settled releases
 * the process for reuse. Connection failures close it instead.
 */
export class PiRpcSession {
  private callbacks: PiRpcSessionCallbacks;
  private client: PiRpcClient;
  private pipeline: AgentStreamPipeline;
  private readonly inactivityTimeoutMs: number;
  private aborted = false;
  private lastEventAt = Date.now();
  private inactivityTimer?: NodeJS.Timeout;
  private resolveRun?: (result: { aborted: boolean }) => void;
  private rejectRun?: (error: Error) => void;
  private runStarted = false;
  private sawRunEvent = false;
  // Settlement-gap bookkeeping: `agent_settled` only arrives after pi's own
  // post-run work (retry / compaction / queued continuations). These track how
  // long pi stayed silent after its last output and how chatty the gap was,
  // which is the part a host cannot see from the adapter's event stream.
  private agentEndAt?: number;
  private eventsSinceAgentEnd = 0;
  private lastOutputAt?: number;
  private turnEndAt?: number;
  private runPromise?: Promise<{ aborted: boolean }>;
  private abortPromise?: Promise<void>;
  private startPromise?: Promise<void>;
  private closePromise?: Promise<void>;
  private closed = false;
  private reuseDisabled = false;

  constructor(private readonly options: PiRpcSessionOptions) {
    this.callbacks = options;
    this.inactivityTimeoutMs = options.inactivityTimeoutMs ?? DEFAULT_INACTIVITY_TIMEOUT_MS;
    this.pipeline = this.createPipeline();
    this.client = this.createClient(options.autoCloseOnSettle === false);
  }

  private createClient(
    operationContext: boolean,
    resumeSessionId = this.options.resumeSessionId,
  ): PiRpcClient {
    const options = this.options;
    return new PiRpcClient({
      // Resume the native pi session when one is known — mirrors the legacy
      // `--session-id` resume of the json path.
      args: [...(resumeSessionId ? ['--session-id', resumeSessionId] : []), ...options.args],
      commandPath: options.commandPath,
      cwd: options.cwd,
      detached: options.detached,
      env: options.env,
      onError: (error) => this.failRun(error),
      onEvent: (event) => this.handleEvent(event),
      onExtensionUiRequest: options.onExtensionUiRequest,
      onRawStdout: options.onRawStdout,
      onStderr: (data) => this.callbacks.onStderr(data),
      operationContext,
    });
  }

  get pid(): number | undefined {
    return this.client.pid;
  }

  /**
   * Thinking levels the bound model serves. Starts the process on demand — the
   * answer follows the model pi resolved from the session args.
   */
  async getAvailableThinkingLevels(timeoutMs?: number): Promise<string[]> {
    if (!this.client.isReady) await this.start();
    return this.client.getAvailableThinkingLevels(timeoutMs);
  }

  /**
   * Apply a thinking level to the live process. Pi clamps to the model's own levels.
   */
  async setThinkingLevel(level: string): Promise<void> {
    if (!this.client.isReady) await this.start();
    await this.client.setThinkingLevel(level);
  }

  /**
   * Rebind the host callbacks — required when a pooled process is reused by
   * a later run whose IPC session (and trace) differs from the run that
   * spawned the process.
   */
  rebind(callbacks: PiRpcSessionCallbacks): void {
    if (this.runStarted) throw new Error('PiRpcSession already has an active run');
    this.callbacks = callbacks;
  }

  private createPipeline(): AgentStreamPipeline {
    return new AgentStreamPipeline({
      agentType: 'pi',
      cwd: this.options.cwd,
      operationId: this.callbacks.operationId,
      uploadImage: this.options.uploadImage,
    });
  }

  /** True while a prompt run is in flight — the pool won't reuse a busy session. */
  get isRunning(): boolean {
    return this.runStarted;
  }

  get isReusable(): boolean {
    return !this.closed && !this.reuseDisabled && !this.runStarted && this.client.isReady;
  }

  /**
   * Start the RPC process and handshake. Idempotent. Rejects with a
   * `PiRpcConnectionError` on spawn/handshake failure (hard-fail).
   */
  start(): Promise<void> {
    if (this.closed) return Promise.reject(new PiRpcConnectionError('Pi RPC session is closed'));
    this.startPromise ??= this.startClient().then(() => {
      if (this.closed) throw new PiRpcConnectionError('Pi RPC session is closed');
      const sessionId = this.client.sessionId;
      if (sessionId) this.callbacks.onSessionId(sessionId);
      this.phase('ready', { pid: this.pid, sessionId: sessionId ?? null });
      this.emitStatus('idle');
    });
    return this.startPromise;
  }

  /** Best-effort timing hook — diagnostics must never break a run. */
  private phase(name: string, detail?: Record<string, unknown>): void {
    try {
      this.options.onPhase?.(name, detail);
    } catch {
      /* ignore */
    }
  }

  private async startClient(): Promise<void> {
    try {
      await this.client.start();
    } catch (error) {
      if (!(error instanceof PiOperationContextUnavailableError) || this.closed) throw error;
      // start() has confirmed the old process is gone. No user prompt has
      // been sent, so one non-pooled RPC attempt cannot duplicate model work.
      this.reuseDisabled = true;
      console.warn('[PiRpcSession] Operation extension unavailable; using single-turn RPC:', error);
      this.client = this.createClient(false, this.client.sessionId);
      await this.client.start();
    }
  }

  /**
   * Run one prompt to completion. Resolves `{ aborted: false }` on
   * `agent_settled`; `{ aborted: true }` when the run was interrupted;
   * rejects on error / process death. Failed runs always close the process.
   */
  run(prompt: PiRpcPromptInput): Promise<{ aborted: boolean }> {
    if (this.runStarted) return Promise.reject(new Error('PiRpcSession already has an active run'));
    if (this.closed) return Promise.reject(new PiRpcConnectionError('Pi RPC session is closed'));
    this.runStarted = true;
    this.sawRunEvent = false;
    this.agentEndAt = undefined;
    this.eventsSinceAgentEnd = 0;
    this.lastOutputAt = undefined;
    this.turnEndAt = undefined;
    this.abortPromise = undefined;
    this.runPromise = this.runPrompt(prompt);
    return this.runPromise;
  }

  private async runPrompt(prompt: PiRpcPromptInput): Promise<{ aborted: boolean }> {
    // Reserve before awaiting startup. Each turn needs a fresh PiAdapter.
    this.pipeline = this.createPipeline();
    this.aborted = false;
    let contextInstalled = false;
    const completion = new Promise<{ aborted: boolean }>((resolve, reject) => {
      this.resolveRun = resolve;
      this.rejectRun = reject;
    });
    const sendPrompt = async () => {
      await this.start();
      if (this.closed) throw new PiRpcConnectionError('Pi RPC session is closed');
      const sessionId = this.client.sessionId;
      if (sessionId) await this.pushEvent({ id: sessionId, type: 'session' }, this.pipeline);
      // Cancellation may arrive during startup or pipeline initialization.
      if (this.aborted) {
        this.settleRun({ aborted: true });
        return;
      }
      await this.client.setOperationContext(this.callbacks.shellOperationId ?? null);
      contextInstalled = true;
      if (this.closed) throw new PiRpcConnectionError('Pi RPC session is closed');
      if (this.aborted) {
        this.settleRun({ aborted: true });
        return;
      }
      this.armInactivityTimer();
      this.emitStatus('running');
      const command: PiRpcCommand = {
        type: 'prompt',
        message: prompt.text,
        ...(prompt.images?.length ? { images: prompt.images } : {}),
      };
      const response = await this.client.command(command);
      this.phase('prompt:accepted', { success: response.success });
      if (!response.success) {
        throw new PiRpcResponseError('prompt', response.error ?? 'Unknown error');
      }
    };
    let failed = false;
    try {
      // Observe both promises immediately: process death may precede the ACK,
      // and agent_settled may arrive before command() resumes.
      const [result] = await Promise.all([completion, sendPrompt()]);
      this.phase('run:settled', { aborted: result.aborted, contextInstalled });
      this.clearInactivityTimer();
      if (contextInstalled && !this.closed) {
        try {
          await this.client.clearOperationContext();
        } catch (error) {
          console.error('[PiRpcSession] Operation cleanup failed; discarding process:', error);
          await this.close();
        }
      }
      return result;
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      this.clearInactivityTimer();
      this.resolveRun = undefined;
      this.rejectRun = undefined;
      if (failed || this.reuseDisabled || this.options.autoCloseOnSettle !== false) {
        await this.close().catch(() => {
          /* best-effort cleanup */
        });
      }
      this.runStarted = false;
    }
  }

  /** Confirm run completion, or confirmed process shutdown, before returning. */
  abort(): Promise<void> {
    if (this.abortPromise) return this.abortPromise;
    if (!this.runStarted || !this.runPromise) return this.closePromise ?? Promise.resolve();
    this.aborted = true;
    this.abortPromise = this.abortRun(this.runPromise);
    return this.abortPromise;
  }

  private async abortRun(run: Promise<{ aborted: boolean }>): Promise<void> {
    if (!this.client.isReady) {
      await this.close();
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all([this.client.abort(), run]),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new PiRpcConnectionError('Pi cancellation did not settle in time')),
            PI_RPC_ABORT_TIMEOUT_MS,
          );
        }),
      ]);
    } catch (error) {
      console.error('[PiRpcSession] Graceful cancellation failed; closing process:', error);
      // Failure to confirm shutdown must reject all the way to the operation
      // cancellation gate; otherwise it can start a second native writer.
      await this.close();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Close the underlying process (graceful EOF → escalate). */
  close(options?: { force?: boolean }): Promise<void> {
    if (this.closePromise) {
      if (options?.force)
        void this.client
          .close(options)
          .catch((error) => console.error('[PiRpcSession] Forced close failed:', error));
      return this.closePromise;
    }
    this.closed = true;
    this.clearInactivityTimer();
    this.phase('close:start', { force: options?.force === true });
    this.closePromise = this.client.close(options).finally(() => {
      this.phase('close:end', {});
      this.settleRun({ aborted: true });
      this.emitStatus('closed');
    });
    return this.closePromise;
  }

  /** Send a follow-up message while the process is (briefly) alive. */
  async followUp(message: string, images?: PiRpcImage[]): Promise<void> {
    await this.client.command({
      type: 'follow_up',
      message,
      ...(images?.length ? { images } : {}),
    });
  }

  /** Send a steering message while the process is (briefly) alive. */
  async steer(message: string, images?: PiRpcImage[]): Promise<void> {
    await this.client.command({ type: 'steer', message, ...(images?.length ? { images } : {}) });
  }

  /** Manually compact the session context. */
  async compact(customInstructions?: string): Promise<void> {
    await this.client.command({
      type: 'compact',
      ...(customInstructions ? { customInstructions } : {}),
    });
  }

  /**
   * Track the run's own progress so the settlement gap can be attributed: a
   * long `sinceLastOutputMs` with `eventsAfterAgentEnd === 0` means pi went
   * quiet after finishing (no retry, no compaction) — the host simply waited.
   */
  private trackRunProgress(event: PiRpcEvent): void {
    const now = Date.now();
    if (this.agentEndAt !== undefined && event.type !== 'agent_end') {
      this.eventsSinceAgentEnd += 1;
    }
    switch (event.type) {
      case 'agent_end': {
        this.agentEndAt = now;
        this.eventsSinceAgentEnd = 0;
        break;
      }
      case 'bash_execution_update':
      case 'message_end':
      case 'message_update':
      case 'tool_execution_end': {
        this.lastOutputAt = now;
        break;
      }
      case 'turn_end': {
        this.turnEndAt = now;
        this.lastOutputAt = now;
        break;
      }
      default:
    }
  }

  private async handleEvent(event: PiRpcEvent): Promise<void> {
    if (this.closed) return;
    this.lastEventAt = Date.now();

    // Capture the pipeline for THIS event — `run()` swaps in a fresh pipeline
    // (new PiAdapter per run) after start(), and push + flush must stay on
    // the same instance or a deferred adapter error would be flushed against
    // an empty state.
    const pipeline = this.pipeline;

    if (event.type === 'session') {
      const sessionEvent = event as PiSessionEvent;
      if (typeof sessionEvent.id === 'string') this.callbacks.onSessionId(sessionEvent.id);
      return;
    }

    if (!this.runStarted) return;
    if (!this.sawRunEvent) {
      this.sawRunEvent = true;
      this.phase('run:firstEvent', { type: event.type });
    }
    this.trackRunProgress(event);
    this.armInactivityTimer();
    if (isTerminalAbortedEvent(event)) this.aborted = true;
    const events = await this.pushEvent(event, pipeline);
    if (event.type !== 'agent_settled') return;
    // pi has nothing left to run: retries, compaction and queued continuations
    // are all done. Everything the user perceives between here and the UI
    // stopping happens *after* this line.
    const settledAt = Date.now();
    // The gap a host cannot see: how long pi stayed quiet after its last
    // output / `agent_end`, and whether anything happened in between (a retry or
    // an auto-compaction keeps `eventsAfterAgentEnd` climbing; pure silence
    // leaves it at 0).
    this.phase('agent_settled', {
      aborted: this.aborted,
      eventsAfterAgentEnd: this.eventsSinceAgentEnd,
      sinceAgentEndMs: this.agentEndAt === undefined ? null : settledAt - this.agentEndAt,
      sinceLastOutputMs: this.lastOutputAt === undefined ? null : settledAt - this.lastOutputAt,
      sinceTurnEndMs: this.turnEndAt === undefined ? null : settledAt - this.turnEndAt,
    });
    const error = events.find((item) => item.type === 'error');
    if (error) this.failRun(new Error(error.data.message ?? 'Pi run failed'));
    else this.settleRun({ aborted: this.aborted });
  }

  private async pushEvent(
    event: PiRpcEvent,
    pipeline: AgentStreamPipeline,
  ): Promise<AgentStreamEvent[]> {
    // Serialize back to a JSONL line and reuse the same pipeline the legacy
    // CLI path uses — PiAdapter consumes the identical event shapes.
    const line = `${JSON.stringify(event)}\n`;
    const events = await pipeline.push(line);
    if (pipeline.sessionId) this.callbacks.onSessionId(pipeline.sessionId);
    await this.callbacks.onEvents(events);
    return events;
  }

  private settleRun(result: { aborted: boolean }): void {
    const resolve = this.resolveRun;
    this.resolveRun = undefined;
    this.rejectRun = undefined;
    resolve?.(result);
  }

  private failRun(error: Error): void {
    const reject = this.rejectRun;
    this.resolveRun = undefined;
    this.rejectRun = undefined;
    reject?.(error);
  }

  private armInactivityTimer(): void {
    this.clearInactivityTimer();
    this.inactivityTimer = setTimeout(() => {
      if (!this.runStarted) return;
      const error = new PiRpcConnectionError(
        `Pi RPC produced no events for ${this.inactivityTimeoutMs}ms`,
        { phase: 'run' },
      );
      this.emitStatus('stale');
      this.failRun(error);
      void this.close().catch(() => {
        /* best-effort */
      });
    }, this.inactivityTimeoutMs);
    this.inactivityTimer.unref?.();
  }

  private clearInactivityTimer(): void {
    if (!this.inactivityTimer) return;
    clearTimeout(this.inactivityTimer);
    this.inactivityTimer = undefined;
  }

  private emitStatus(state: HeterogeneousAgentRuntimeStatus['state']): void {
    this.callbacks.onRuntimeStatus({
      activeTasks: [],
      lastEventAt: this.lastEventAt,
      operationId: this.callbacks.operationId,
      sessionId: this.callbacks.sessionId,
      state,
      transport: 'pi-rpc',
    });
  }
}
