import { PiRpcClient } from './piRpcClient';
import type { PiRpcStateData } from './piRpcProtocol';
import { PI_RPC_HANDSHAKE_TIMEOUT_MS } from './piRpcProtocol';

export interface ProbePiThinkingLevelsParams {
  /**
   * Extra CLI args for the probe process, mirroring what a real run gets.
   *
   * Pass the run's `--model` (and provider args) so pi binds the same model
   * before answering: pi derives the level list from the bound model, and an
   * unbound session answers the full vocabulary instead of the real one.
   */
  args?: string[];
  /** Absolute (or resolved) path to the `pi` executable. */
  commandPath: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Startup handshake timeout. */
  handshakeTimeoutMs?: number;
  /** Response timeout for the levels query. */
  timeoutMs?: number;
}

export interface PiThinkingLevelsResult {
  /** Levels the bound model serves, in pi's own order (may be a single level). */
  levels: string[];
  /** The model pi resolved from the probe args, when it reported one. */
  model?: PiRpcStateData['model'];
  /** The level the probe session sits on (pi's default when none was requested). */
  thinkingLevel?: string;
}

/**
 * Probe a short-lived `pi --mode rpc` process for the thinking levels of one
 * model.
 *
 * Pi answers this per session — the list follows `getSupportedThinkingLevels`
 * of the bound model — so this spawns a real process with the caller's args
 * rather than reading a static table. One handshake + one query, then a
 * graceful close; the caller owns caching because the cost is a process start.
 */
export const probePiThinkingLevels = async (
  params: ProbePiThinkingLevelsParams,
): Promise<PiThinkingLevelsResult> => {
  const timeoutMs = params.timeoutMs ?? PI_RPC_HANDSHAKE_TIMEOUT_MS;
  const client = new PiRpcClient({
    args: params.args ?? [],
    commandPath: params.commandPath,
    cwd: params.cwd,
    env: params.env,
    handshakeTimeoutMs: params.handshakeTimeoutMs,
    // A probe has no run to steer: events only carry run noise, and stderr is
    // surfaced by the thrown connection error instead.
    onEvent: () => {},
    onStderr: () => {},
    requestTimeoutMs: timeoutMs,
  });

  try {
    await client.start();
    const levels = await client.getAvailableThinkingLevels(timeoutMs);

    return {
      levels,
      model: client.model,
      thinkingLevel: client.thinkingLevel,
    };
  } finally {
    await client.close().catch(() => {
      /* best-effort cleanup: the probe result already settled */
    });
  }
};
