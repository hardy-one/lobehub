import type {
  HeterogeneousAgentModelCatalogErrorCode,
  HeterogeneousThinkingLevels,
  ProbeHeterogeneousThinkingLevelsParams,
} from '@lobechat/types';

import { PiRpcConnectionError } from '../rpc/piRpcClient';
import { probePiThinkingLevels } from '../rpc/probePiThinkingLevels';
import { resolveHeteroSpawnCommand } from '../spawn/resolveCliCommand';

const PROBE_TIMEOUT_MS = 15_000;

const PROBE_ERROR_MESSAGES: Record<HeterogeneousAgentModelCatalogErrorCode, string> = {
  cli_not_found: 'Pi CLI was not found',
  command_failed: 'Pi thinking-level probe failed',
  device_unavailable: 'The device is not available',
  timeout: 'Pi thinking-level probe timed out',
  unsupported_client: 'This Pi CLI cannot report thinking levels over RPC',
};

const getErrorRecord = (error: unknown): { code?: string; message: string; phase?: string } => {
  const record = (error ?? {}) as { code?: string; message?: string };
  const phase = error instanceof PiRpcConnectionError ? error.options?.phase : undefined;

  return {
    code: record.code,
    message: error instanceof Error ? error.message : String(error),
    phase,
  };
};

const classifyProbeError = (error: unknown): HeterogeneousAgentModelCatalogErrorCode => {
  const { code, message, phase } = getErrorRecord(error);

  if (code === 'ENOENT') return 'cli_not_found';
  if (code === 'ETIMEDOUT') return 'timeout';
  // The RPC client hard-fails on a missing or too-old Pi before any command
  // runs; both are "this install cannot answer", not a transient failure.
  if (/Cannot verify Pi version|required; upgrade pi/i.test(message)) return 'unsupported_client';
  if (phase === 'handshake') return 'unsupported_client';
  if (/timed out|timeout/i.test(message)) return 'timeout';

  return 'command_failed';
};

/**
 * Ask the host that will execute the run which thinking levels the selected
 * model serves.
 *
 * Only Pi exposes this (its RPC `get_available_thinking_levels` follows the
 * bound model), so every other type answers `unsupported_client` and the caller
 * keeps its static vocabulary. The resolver-discovered PATH is merged underneath
 * the caller's env, mirroring `listHeterogeneousAgentModels`.
 */
export const probeHeterogeneousThinkingLevels = async (
  params: ProbeHeterogeneousThinkingLevelsParams,
): Promise<HeterogeneousThinkingLevels> => {
  const updatedAt = Date.now();

  if (params.type !== 'pi') {
    return {
      error: { code: 'unsupported_client', message: PROBE_ERROR_MESSAGES.unsupported_client },
      status: 'error',
      updatedAt,
    };
  }

  const resolved = await resolveHeteroSpawnCommand(params.type, params.command);
  const callerEnv = params.env ?? process.env;
  const mergedPath = [
    ...new Set(
      [callerEnv.PATH, resolved.pathEnv]
        .filter(Boolean)
        .join(process.platform === 'win32' ? ';' : ':')
        .split(process.platform === 'win32' ? ';' : ':'),
    ),
  ]
    .filter(Boolean)
    .join(process.platform === 'win32' ? ';' : ':');
  const env = {
    ...callerEnv,
    ...(mergedPath ? { PATH: mergedPath } : {}),
  };

  try {
    const result = await probePiThinkingLevels({
      args: params.args ?? [],
      commandPath: resolved.command,
      cwd: params.cwd ?? process.cwd(),
      env: env as NodeJS.ProcessEnv,
      timeoutMs: PROBE_TIMEOUT_MS,
    });

    return {
      levels: result.levels,
      status: 'success',
      updatedAt,
    };
  } catch (error) {
    const code = classifyProbeError(error);
    return {
      error: { code, message: PROBE_ERROR_MESSAGES[code] },
      status: 'error',
      updatedAt,
    };
  }
};
