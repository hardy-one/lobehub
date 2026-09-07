import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';

import {
  buildHeteroExecStdinPayload,
  HETERO_EXEC_INHERIT_PROCESS_GROUP_ENV,
  type HeteroExecImageRef,
} from '@lobechat/heterogeneous-agents/protocol';
import { resolveHeteroSpawnCwd } from '@lobechat/heterogeneous-agents/workingDirectory';

import { getTask, removeTask, saveTask } from '../daemon/taskRegistry';
import { registerAgentRun } from './agentRunRegistry';

export interface SpawnHeteroAgentRunParams {
  agentType: string;
  /** Resolved `lh hetero exec` wrapper args. */
  args?: string[];
  assistantMessageId?: string;
  cwd?: string;
  /** Image attachments (signed URLs) appended as image content blocks. */
  imageList?: HeteroExecImageRef[];
  jwt: string;
  operationId: string;
  prompt: string;
  /** System context used only by the automatic retry without native resume. */
  resumeFallbackSystemContext?: string;
  resumeSessionId?: string;
  serverUrl: string;
  systemContext?: string;
  topicId: string;
  /** Topic/run workspace — forwarded as `LOBEHUB_WORKSPACE_ID` for ingest. */
  workspaceId?: string;
}

export interface AgentRunAckResult {
  reason?: string;
  status: 'accepted' | 'rejected';
}

export interface AgentRunCancellationResult {
  exited: boolean;
  pid?: number;
  signal: NodeJS.Signals;
}

interface SpawnHeteroAgentRunLogger {
  error?: (msg: string) => void;
  info?: (msg: string) => void;
}

interface RunningHeteroAgentRun {
  agentType: string;
  cancellation?: Promise<AgentRunCancellationResult>;
  child: ChildProcess;
  exit: Promise<void>;
}

/**
 * The connect daemon is the process that owns the wrapper and, transitively,
 * the native Pi process. Keep the owner-side registry here instead of trying
 * to discover a PID later from the server. A cancellation is therefore sent
 * to the exact child created for the operation, not to a stale topic or a
 * reused process id.
 */
const runningHeteroAgentRuns = new Map<string, RunningHeteroAgentRun>();

const waitForExit = async (task: RunningHeteroAgentRun, timeoutMs: number): Promise<boolean> => {
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const exited = await Promise.race([task.exit.then(() => true as const), timedOut]);
  if (timer) clearTimeout(timer);
  return exited;
};

/**
 * Cancel a gateway-dispatched local CLI wrapper.
 *
 * The wrapper installs an early signal handler and forwards the signal to the
 * native agent's own process group. A repeated graceful signal asks the
 * wrapper to escalate its inner process group; only after that bounded drain
 * do we force-kill the wrapper itself. This makes the device response mean
 * "the owner stopped" rather than merely "the device received an RPC".
 */
export const cancelHeteroAgentRun = async (params: {
  operationId: string;
  signal?: NodeJS.Signals;
}): Promise<AgentRunCancellationResult | undefined> => {
  const { operationId, signal = 'SIGINT' } = params;
  const task = runningHeteroAgentRuns.get(operationId);
  if (!task) return;
  if (task.cancellation) return task.cancellation;

  // Pi's print/json mode does not reliably clean up its detached tool workers
  // on SIGINT. SIGTERM is the provider's cooperative process-tree shutdown
  // signal; the wrapper still reports the run as cancelled to the server.
  const cancellationSignal = task.agentType === 'pi' && signal === 'SIGINT' ? 'SIGTERM' : signal;

  task.cancellation = (async () => {
    try {
      task.child.kill(cancellationSignal);
    } catch {
      // The wrapper may have exited between lookup and signalling.
    }

    let exited = await waitForExit(task, 2_000);
    if (!exited) {
      try {
        // A repeated signal is handled by `lh hetero exec`, which force-
        // kills the native agent's detached process group. Do this before
        // killing the wrapper, otherwise Pi's tool workers can be orphaned.
        task.child.kill(cancellationSignal);
      } catch {
        // Continue to the bounded result below.
      }
      exited = await waitForExit(task, 2_000);
    }

    if (!exited) {
      try {
        task.child.kill('SIGKILL');
      } catch {
        // The wrapper may have exited while the final signal was in flight.
      }
      exited = await waitForExit(task, 1_000);
    }

    return { exited, pid: task.child.pid, signal: cancellationSignal };
  })();

  return task.cancellation;
};

/**
 * Spawn `lh hetero exec` for a gateway-dispatched agent run. The wrapper owns
 * the full pipeline (spawn -> adapt -> BatchIngester -> server ingest), so the
 * connect daemon only kicks it off and retains its process handle for a later
 * cancellation request.
 */
export function spawnHeteroAgentRun(
  params: SpawnHeteroAgentRunParams,
  logger?: SpawnHeteroAgentRunLogger,
): Promise<AgentRunAckResult> {
  const {
    agentType,
    assistantMessageId,
    args: extraArgs,
    cwd,
    imageList,
    jwt,
    operationId,
    prompt,
    resumeFallbackSystemContext,
    resumeSessionId,
    serverUrl,
    systemContext,
    topicId,
    workspaceId,
  } = params;
  const workDir = cwd ?? process.cwd();
  // A stale project path must not prevent the wrapper CLI from starting: the
  // inner spawnAgent preflight owns cwd classification and reports the
  // structured working_directory_not_found error through heteroFinish.
  const spawnCwd = resolveHeteroSpawnCwd(workDir);

  const cliArgs = [
    process.argv[1],
    'hetero',
    'exec',
    '--type',
    agentType,
    '--operation-id',
    operationId,
    '--topic',
    topicId,
    '--render',
    'none',
    '--input-json',
    '-',
    '--cwd',
    workDir,
    ...(resumeSessionId ? ['--resume', resumeSessionId] : []),
    ...(extraArgs ?? []),
  ];

  const stdinPayload = buildHeteroExecStdinPayload({
    imageList,
    prompt,
    resumeFallbackSystemContext,
    systemContext,
  });

  // A connector can itself be started inside another agent run. Its ambient
  // identity belongs to the launcher, not this dispatched conversation; CLI
  // evidence commands must never attach this run's outputs to that ancestor.
  const childEnv = { ...process.env };
  for (const key of [
    'LOBEHUB_AGENT_ID',
    'LOBEHUB_ASSISTANT_MESSAGE_ID',
    'LOBEHUB_TASK_ID',
    'LOBEHUB_WORKSPACE_ID',
  ]) {
    delete childEnv[key];
  }

  return new Promise<AgentRunAckResult>((resolve) => {
    let settled = false;
    const settle = (result: AgentRunAckResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let pid: number | undefined;
    const child = spawn(process.execPath, [...process.execArgv, ...cliArgs], {
      cwd: spawnCwd,
      // Give the wrapper its own group. The wrapper's signal handler then
      // forwards cancellation to the native agent group it creates, while a
      // force-kill still cannot take down the connect daemon itself.
      detached: process.platform !== 'win32',
      env: {
        ...childEnv,
        ...(assistantMessageId ? { LOBEHUB_ASSISTANT_MESSAGE_ID: assistantMessageId } : {}),
        [HETERO_EXEC_INHERIT_PROCESS_GROUP_ENV]: '1',
        LOBEHUB_JWT: jwt,
        LOBEHUB_OPERATION_ID: operationId,
        LOBEHUB_SERVER: serverUrl,
        LOBEHUB_TOPIC_ID: topicId,
        ...(workspaceId ? { LOBEHUB_WORKSPACE_ID: workspaceId } : {}),
      },
      stdio: ['pipe', 'inherit', 'inherit'],
      windowsHide: true,
    });

    const exit = new Promise<void>((resolveExit) => {
      child.once('exit', () => resolveExit());
      child.once('error', () => resolveExit());
    });
    const task: RunningHeteroAgentRun = { agentType, child, exit };
    runningHeteroAgentRuns.set(operationId, task);

    child.once('spawn', () => {
      registerAgentRun(operationId, child);
      // Register the child into the task registry so `cancelHeteroTask`
      // dispatched from the server can resolve it by operationId and signal
      // the whole process group. `detached: true` places the CLI in its own
      // group; the inherited-group env contract keeps its agent descendants
      // in that same group without affecting the connect daemon.
      pid = child.pid;
      if (pid !== undefined) {
        saveTask({
          agentType,
          operationId,
          pid,
          startedAt: new Date().toISOString(),
          taskId: operationId,
          topicId,
          workspaceId,
        });
      }

      // Only safe to write stdin once the process actually started.
      try {
        child.stdin?.write(stdinPayload);
        child.stdin?.end();
      } catch (err) {
        logger?.error?.(
          `hetero exec stdin write failed (op=${operationId}): ${(err as Error).message}`,
        );
      }
      settle({ status: 'accepted' });
    });

    child.once('error', (err) => {
      logger?.error?.(`hetero exec spawn failed (op=${operationId}): ${err.message}`);
      if (runningHeteroAgentRuns.get(operationId)?.child === child) {
        runningHeteroAgentRuns.delete(operationId);
      }
      settle({ reason: err.message, status: 'rejected' });
    });

    child.on('exit', (code, signal) => {
      // Only remove the registry entry if the exiting PID still owns this
      // task — a newer run that reused the same operationId must not be
      // cleared by a stale exit event.
      if (pid !== undefined && getTask(operationId)?.pid === pid) {
        removeTask(operationId);
      }
      logger?.info?.(`hetero exec exited (op=${operationId}) code=${code} signal=${signal}`);
      if (runningHeteroAgentRuns.get(operationId)?.child === child) {
        runningHeteroAgentRuns.delete(operationId);
      }
    });
  });
}
