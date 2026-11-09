import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  buildDatabaseUrl,
  cloneDatabase,
  dropDatabase,
  migrateDatabase,
  parseDatabaseUrl,
  repointMockProvider,
  seedDatabase,
} from './database';
import {
  getScenario,
  HARNESS_AGENT_PROMPT,
  PROMPT_SCENARIOS,
  type PromptScenario,
} from './fixtures';
import { allocatePort, isPortOpen, waitForHttp, waitForPort } from './ports';
import { type ManagedProcess, spawnManaged, stopAll } from './processes';
import {
  type HarnessManifest,
  type ScenarioRun,
  type VerificationCheck,
  verifyHarnessRun,
} from './verify';

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

class ScenarioRunError extends Error {
  constructor(
    message: string,
    readonly operationId: string,
    readonly topicId: string,
  ) {
    super(message);
  }
}

const parseArgs = (argv: string[]) => {
  let scenarioIds = PROMPT_SCENARIOS.map((scenario) => scenario.id);
  let infoFile: string | undefined;
  let keep = false;
  let serve = false;
  let updateBaseline = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--keep') {
      keep = true;
    } else if (arg === '--serve') {
      serve = true;
    } else if (arg === '--update-baseline') {
      updateBaseline = true;
    } else if (arg === '--info-file') {
      infoFile = argv[++index];
    } else if (arg.startsWith('--info-file=')) {
      infoFile = arg.slice('--info-file='.length);
    } else if (arg === '--scenario') {
      scenarioIds = [argv[++index] ?? ''];
    } else if (arg.startsWith('--scenario=')) {
      scenarioIds = arg.slice('--scenario='.length).split(',').filter(Boolean);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { infoFile, keep, scenarioIds: scenarioIds.map(getScenario), serve, updateBaseline };
};

const readCaptureFiles = async (captureDir: string): Promise<string[]> =>
  (await readdir(captureDir)).filter((file) => /^\d{3}-.*\.json$/.test(file)).sort();

const isAgentPromptCapture = async (captureDir: string, file: string): Promise<boolean> => {
  const capture = JSON.parse(await readFile(path.join(captureDir, file), 'utf8')) as {
    mockResponse?: { object?: string; protocol?: string };
    rawRequest?: { messages?: unknown; tools?: unknown };
  };
  // Agent Signal uses the Responses API for auxiliary classification. Those
  // calls are not the product request under test. Compression side calls also
  // use Chat Completions but omit the native tool catalogue.
  return (
    capture.mockResponse?.protocol !== 'responses' &&
    capture.mockResponse?.object === 'chat.completion' &&
    Array.isArray(capture.rawRequest?.messages) &&
    Array.isArray(capture.rawRequest?.tools)
  );
};

const parseOperationId = (stdout: string): string => {
  const parsed = JSON.parse(stdout) as
    Array<{ operationId?: string; type?: string }> | { operationId?: string };
  if (!Array.isArray(parsed)) {
    if (!parsed.operationId) throw new Error('CLI JSON did not contain an operation id.');
    return parsed.operationId;
  }
  const events = parsed;
  const operation = events.find((event) => event.type === 'connected' && event.operationId);
  if (!operation?.operationId)
    throw new Error('CLI JSON did not contain a connected operation id.');
  return operation.operationId;
};

const parseTopicId = (stdout: string, operationId: string): string => {
  const parsed = JSON.parse(stdout) as
    | Array<{
        data?: { topicId?: string; uiMessages?: Array<{ topicId?: string }> };
        type?: string;
      }>
    | { topicId?: string };
  if (!Array.isArray(parsed)) {
    if (parsed.topicId) return parsed.topicId;
    const fromOperation = operationId.match(/tpc_[A-Za-z0-9]+/)?.[0];
    if (fromOperation) return fromOperation;
    throw new Error(`Could not resolve a topic id from CLI JSON for ${operationId}.`);
  }
  const events = parsed;
  const fromEvent =
    events.find((event) => event.type === 'agent_runtime_init')?.data?.topicId ??
    events
      .find((event) => event.type === 'step_start')
      ?.data?.uiMessages?.find((message) => message.topicId)?.topicId;
  if (fromEvent) return fromEvent;

  const fromOperation = operationId.match(/tpc_[A-Za-z0-9]+/)?.[0];
  if (fromOperation) return fromOperation;
  throw new Error(`Could not resolve a topic id from CLI JSON for ${operationId}.`);
};

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
};

const assertTestEnvironment = () => {
  requireEnv('PROMPT_HARNESS_ENV');
  if (process.env.PROMPT_HARNESS_ENV !== 'test') {
    throw new Error('PROMPT_HARNESS_ENV must be exactly "test".');
  }
  for (const value of [
    process.env.APP_URL,
    process.env.LOBEHUB_SERVER,
    process.env.PROMPT_HARNESS_PRODUCTION_URL,
  ]) {
    if (!value) continue;
    if (
      value.includes('_dangerous_local_dev_proxy') ||
      value.includes('app.lobehub.com') ||
      value.includes(':3010')
    ) {
      throw new Error(`Harness refuses production/dev-proxy URL: ${value}`);
    }
  }
};

const waitForOperation = async ({
  cliHome,
  operationId,
  runRoot,
  scenarioId,
  serverUrl,
}: {
  cliHome: string;
  operationId: string;
  runRoot: string;
  scenarioId: string;
  serverUrl: string;
}): Promise<void> => {
  const apiKey = requireEnv('LOBEHUB_CLI_API_KEY');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    LOBE_API_KEY: apiKey,
    LOBEHUB_CLI_API_KEY: apiKey,
    LOBEHUB_CLI_HOME: cliHome,
    LOBEHUB_JWT: '',
    LOBEHUB_SERVER: serverUrl,
  };
  delete env.LOBEHUB_JWT;
  delete env.LOBEHUB_JWT_FILE;
  delete env.LOBEHUB_OPERATION_ID;
  delete env.LOBEHUB_AGENT_ID;
  delete env.LOBEHUB_ASSISTANT_MESSAGE_ID;
  delete env.LOBEHUB_TASK_ID;
  delete env.LOBEHUB_TOPIC_ID;
  delete env.LOBEHUB_WORKSPACE_ID;
  delete env.LOBEHUB_HETERO_EXEC_INHERIT_PROCESS_GROUP;

  const deadline = Date.now() + 180_000;
  let lastStatus = '';
  while (Date.now() < deadline) {
    const result = await execFileAsync(
      'bun',
      ['src/index.ts', 'agent', 'status', operationId, '--json'],
      {
        cwd: path.join(repoRoot, 'apps/cli'),
        env,
        maxBuffer: 8 * 1024 * 1024,
      },
    );
    const status = JSON.parse(result.stdout) as {
      currentState?: { error?: unknown; status?: string };
      error?: unknown;
      needsHumanInput?: boolean;
      status?: string;
    };
    const current = status.currentState?.status ?? status.status;
    if (current && current !== lastStatus) {
      lastStatus = current;
      console.log(`${scenarioId} operation status: ${current}`);
    }
    if (['completed', 'done', 'success'].includes(current ?? '')) {
      await writeFile(
        path.join(runRoot, 'runs', `${scenarioId}.status.json`),
        JSON.stringify(status, null, 2),
      );
      return;
    }
    if (
      ['aborted', 'canceled', 'cancelled', 'error', 'failed', 'interrupted'].includes(current ?? '')
    ) {
      const error = status.currentState?.error ?? status.error;
      throw new Error(
        `${scenarioId} operation ${operationId} ended as ${current}: ${JSON.stringify(error)}`,
      );
    }
    if (status.needsHumanInput) {
      throw new Error(`${scenarioId} operation ${operationId} is waiting for human input`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${scenarioId} operation ${operationId} did not finish within 180 seconds`);
};

const runScenario = async ({
  cliHome,
  scenario,
  serverUrl,
  runRoot,
  topicId,
}: {
  cliHome: string;
  runRoot: string;
  scenario: PromptScenario;
  serverUrl: string;
  topicId?: string;
}): Promise<{ operationId: string; runOutputPath: string; topicId: string }> => {
  const apiKey = requireEnv('LOBEHUB_CLI_API_KEY');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    LOBE_API_KEY: apiKey,
    LOBEHUB_CLI_API_KEY: apiKey,
    LOBEHUB_CLI_HOME: cliHome,
    LOBEHUB_JWT: '',
    LOBEHUB_SERVER: serverUrl,
  };
  delete env.LOBEHUB_JWT;
  delete env.LOBEHUB_JWT_FILE;
  delete env.LOBEHUB_OPERATION_ID;
  delete env.LOBEHUB_AGENT_ID;
  delete env.LOBEHUB_ASSISTANT_MESSAGE_ID;
  delete env.LOBEHUB_TASK_ID;
  delete env.LOBEHUB_TOPIC_ID;
  delete env.LOBEHUB_WORKSPACE_ID;
  delete env.LOBEHUB_HETERO_EXEC_INHERIT_PROCESS_GROUP;

  const args = [
    'src/index.ts',
    'agent',
    'run',
    '-a',
    scenario.agentId,
    '-p',
    scenario.prompt,
    '--detach',
    '--json',
  ];
  if (topicId) args.push('-t', topicId);
  for (const skill of scenario.selectedSkills ?? []) {
    args.push('--skill', skill);
  }
  const result = await execFileAsync('bun', args, {
    cwd: path.join(repoRoot, 'apps/cli'),
    env,
    maxBuffer: 64 * 1024 * 1024,
  });
  const runOutputPath = path.join(runRoot, 'runs', `${scenario.id}.json`);
  await writeFile(runOutputPath, result.stdout);
  if (result.stderr) {
    await writeFile(path.join(runRoot, 'logs', `${scenario.id}-cli.log`), result.stderr);
  }

  const operationId = parseOperationId(result.stdout);
  const resolvedTopicId = parseTopicId(result.stdout, operationId);
  try {
    await waitForOperation({
      cliHome,
      operationId,
      runRoot,
      scenarioId: scenario.id,
      serverUrl,
    });
  } catch (error) {
    throw new ScenarioRunError(
      error instanceof Error ? error.message : String(error),
      operationId,
      resolvedTopicId,
    );
  }
  return {
    operationId,
    runOutputPath,
    topicId: resolvedTopicId,
  };
};

const inspectTrace = async ({
  cliHome,
  operationId,
  outputPath,
  serverUrl,
}: {
  cliHome: string;
  operationId: string;
  outputPath: string;
  serverUrl: string;
}): Promise<void> => {
  const apiKey = requireEnv('LOBEHUB_CLI_API_KEY');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    LOBE_API_KEY: apiKey,
    LOBEHUB_CLI_API_KEY: apiKey,
    LOBEHUB_CLI_HOME: cliHome,
    LOBEHUB_SERVER: serverUrl,
  };
  delete env.LOBEHUB_JWT;
  delete env.LOBEHUB_JWT_FILE;
  delete env.LOBEHUB_OPERATION_ID;
  delete env.LOBEHUB_AGENT_ID;
  delete env.LOBEHUB_ASSISTANT_MESSAGE_ID;
  delete env.LOBEHUB_TASK_ID;
  delete env.LOBEHUB_TOPIC_ID;
  delete env.LOBEHUB_WORKSPACE_ID;
  delete env.LOBEHUB_HETERO_EXEC_INHERIT_PROCESS_GROUP;

  const result = await execFileAsync('lh', ['trace', 'op', 'inspect', operationId, '-j'], {
    env,
    maxBuffer: 128 * 1024 * 1024,
  });
  await writeFile(outputPath, result.stdout);
};

const main = async () => {
  assertTestEnvironment();
  const { infoFile, keep, scenarioIds, serve, updateBaseline } = parseArgs(process.argv.slice(2));
  const runId = `t105-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const runRoot = await mkdtemp(path.join(tmpdir(), `lobehub-${runId}.`));
  const captureDir = path.join(runRoot, 'captures');
  const traceDir = path.join(runRoot, 'traces');
  const logDir = path.join(runRoot, 'logs');
  await Promise.all([
    mkdir(captureDir, { recursive: true }),
    mkdir(traceDir, { recursive: true }),
    mkdir(logDir, { recursive: true }),
    mkdir(path.join(runRoot, 'runs'), { recursive: true }),
  ]);

  const managed: ManagedProcess[] = [];
  let databaseDropped = false;
  const nextPort = await allocatePort();
  const mockPort = await allocatePort([nextPort]);
  const serverUrl = `http://127.0.0.1:${nextPort}`;
  const mockBaseUrl = `http://127.0.0.1:${mockPort}/v1`;
  const databaseParts = parseDatabaseUrl(requireEnv('DATABASE_URL'));
  const runDatabase = `t105_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
  const clonedDatabaseUrl = buildDatabaseUrl(databaseParts, runDatabase);
  const pgContainer = process.env.PROMPT_HARNESS_PG_CONTAINER ?? 'lobehub-agent-testing-postgres';
  const distDir = `.next-${runId}`;
  const cliHome = path.join(runRoot, 'cli-home');
  const freezeClockPath = path.join(repoRoot, 'scripts/promptHarness/freezeClock.cjs');
  const scenarioRuns: ScenarioRun[] = [];
  const scenarioErrors: HarnessManifest['scenarioErrors'] = [];
  const topicByScenario = new Map<string, string>();
  let provider: { providerRowId: string; vaultKeys: string[] } = {
    providerRowId: '',
    vaultKeys: [],
  };
  let failure: unknown;

  const stackInfo = {
    captureDir,
    mockPort,
    nextPort,
    runDatabase,
    runId,
    runRoot,
    serverUrl,
    traceDir,
  };
  console.log(JSON.stringify(stackInfo));
  if (infoFile) {
    await writeFile(infoFile, JSON.stringify(stackInfo, null, 2));
  }

  try {
    await cloneDatabase({
      container: pgContainer,
      sourceDatabase: databaseParts.database,
      targetDatabase: runDatabase,
      user: databaseParts.user,
    });
    await migrateDatabase({
      databaseUrl: clonedDatabaseUrl,
      repoRoot,
    });
    await seedDatabase({
      container: pgContainer,
      database: runDatabase,
      fixturePath: path.join(repoRoot, 'scripts/promptHarness/fixtures/seed.sql'),
      user: databaseParts.user,
    });
    provider = await repointMockProvider({
      databaseUrl: clonedDatabaseUrl,
      keyVaultsSecret: requireEnv('KEY_VAULTS_SECRET'),
      mockBaseUrl,
      userId: 'user_agent_testing_001',
    });

    managed.push(
      spawnManaged({
        args: ['scripts/promptHarness/mockProvider.ts'],
        command: 'bun',
        cwd: repoRoot,
        env: {
          ...process.env,
          PROMPT_HARNESS_CAPTURE_DIR: captureDir,
          PROMPT_HARNESS_MOCK_PORT: String(mockPort),
        },
        logPath: path.join(logDir, 'mock.log'),
        name: 'mock',
      }),
    );
    await waitForHttp({ url: `${mockBaseUrl}/models`, timeoutMs: 15_000 });

    managed.push(
      spawnManaged({
        args: ['dev', '-H', '127.0.0.1', '-p', String(nextPort)],
        command: path.join(repoRoot, 'node_modules/.bin/next'),
        cwd: repoRoot,
        env: {
          ...process.env,
          AGENT_RUNTIME_MODE: 'local',
          APP_URL: serverUrl,
          DATABASE_DRIVER: 'node',
          DATABASE_URL: clonedDatabaseUrl,
          INTERNAL_APP_URL: serverUrl,
          NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require=${freezeClockPath}`]
            .filter(Boolean)
            .join(' '),
          PORT: String(nextPort),
          PROMPT_HARNESS_FROZEN_TIME:
            process.env.PROMPT_HARNESS_FROZEN_TIME ?? '2026-11-02T12:00:00.000Z',
          REDIS_PREFIX: `prompt-harness:${runId}:`,
          REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6380',
          PROMPT_HARNESS_NEXT_DIST_DIR: distDir,
        },
        logPath: path.join(logDir, 'next.log'),
        name: 'next',
      }),
    );
    await waitForPort({ port: nextPort, timeoutMs: 180_000 });
    await waitForHttp({
      timeoutMs: 180_000,
      url: `${serverUrl}/api/v1/users/me?includeCount=0`,
    });

    if (serve) {
      console.log(`Serving isolated prompt harness at ${serverUrl}`);
      console.log('Press Ctrl-C to stop the stack and drop the cloned database.');
      await new Promise<void>((resolve) => {
        const stop = () => resolve();
        process.once('SIGINT', stop);
        process.once('SIGTERM', stop);
      });
      console.log('Stopping isolated prompt harness.');
    }

    if (!serve) {
      for (const scenario of scenarioIds) {
        if (scenario.manualOnly) {
          console.log(`skipped ${scenario.id}: manual product UI scenario`);
          continue;
        }
        try {
          const topicId =
            scenario.topicId ??
            (scenario.topicFromScenarioId
              ? topicByScenario.get(scenario.topicFromScenarioId)
              : undefined);
          if (scenario.topicFromScenarioId && !topicId) {
            throw new Error(
              `${scenario.id} requires the completed topic from ${scenario.topicFromScenarioId}.`,
            );
          }
          for (const fixturePath of scenario.beforeFixturePaths ?? []) {
            await seedDatabase({
              container: pgContainer,
              database: runDatabase,
              fixturePath: path.join(repoRoot, fixturePath),
              user: databaseParts.user,
            });
          }
          const before = new Set(await readCaptureFiles(captureDir));
          let run: Awaited<ReturnType<typeof runScenario>> | undefined;
          let operationId: string | undefined;
          let resolvedTopicId = topicId;
          try {
            run = await runScenario({
              cliHome,
              runRoot,
              scenario,
              serverUrl,
              topicId,
            });
            operationId = run.operationId;
            resolvedTopicId = run.topicId;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (error instanceof ScenarioRunError) {
              operationId = error.operationId;
              resolvedTopicId = error.topicId;
            }
            scenarioErrors.push({
              error: message,
              ...(operationId && { operationId }),
              scenarioId: scenario.id,
            });
            console.error(`failed ${scenario.id}: ${message}`);
          }

          const tracePath = path.join(traceDir, `${scenario.id}.json`);
          if (operationId) {
            try {
              await inspectTrace({
                cliHome,
                operationId,
                outputPath: tracePath,
                serverUrl,
              });
            } catch (error) {
              await writeFile(
                path.join(logDir, `${scenario.id}-trace-error.log`),
                error instanceof Error ? (error.stack ?? error.message) : String(error),
              );
            }
          }
          const after = await readCaptureFiles(captureDir);
          const scenarioCaptureFiles: string[] = [];
          for (const file of after) {
            if (before.has(file)) continue;
            if (await isAgentPromptCapture(captureDir, file)) scenarioCaptureFiles.push(file);
          }
          scenarioRuns.push({
            captureFiles: scenarioCaptureFiles,
            scenario,
            tracePath,
          });
          if (resolvedTopicId) topicByScenario.set(scenario.id, resolvedTopicId);
          for (const fixturePath of scenario.afterFixturePaths ?? []) {
            await seedDatabase({
              container: pgContainer,
              database: runDatabase,
              fixturePath: path.join(repoRoot, fixturePath),
              user: databaseParts.user,
            });
          }
          console.log(
            `${run ? 'captured' : 'captured partial'} ${scenario.id}: ${operationId ?? 'no operation id'}`,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          scenarioErrors.push({ error: message, scenarioId: scenario.id });
          console.error(`failed ${scenario.id}: ${message}`);
        }
      }
    }
  } catch (error) {
    failure = error;
  } finally {
    await stopAll(managed);
    try {
      await dropDatabase({
        container: pgContainer,
        database: runDatabase,
        user: databaseParts.user,
      });
      databaseDropped = true;
    } catch (error) {
      console.error('Failed to drop harness database:', error);
    }
    await rm(path.join(repoRoot, distDir), { force: true, recursive: true });
  }

  const manifest: HarnessManifest = {
    captureDir,
    cleanup: {
      databaseDropped,
      portsClosed:
        !(await isPortOpen('127.0.0.1', nextPort)) && !(await isPortOpen('127.0.0.1', mockPort)),
      processesStopped: managed.every(
        (process) => process.child.exitCode !== null || process.child.signalCode !== null,
      ),
    },
    provider,
    runId,
    runRoot,
    scenarioErrors,
    scenarios: scenarioRuns,
  };
  const manifestPath = path.join(runRoot, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  let checks: VerificationCheck[] = [];
  if (!failure) {
    const baselinePath = path.join(repoRoot, 'scripts/promptHarness/fixtures/legacyBaseline.json');
    const chatBaselinePath = path.join(
      repoRoot,
      'scripts/promptHarness/fixtures/legacyChatBaseline.json',
    );
    let hasBaseline = true;
    let hasChatBaseline = true;
    try {
      await readFile(baselinePath);
    } catch {
      hasBaseline = false;
    }
    try {
      await readFile(chatBaselinePath);
    } catch {
      hasChatBaseline = false;
    }
    const sourceCommit = updateBaseline
      ? await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot })
          .then((result) => result.stdout.trim())
          .catch(() => undefined)
      : undefined;
    checks = await verifyHarnessRun({
      ...(updateBaseline
        ? { legacyBaselinePath: baselinePath, legacyChatBaselinePath: chatBaselinePath }
        : {
            ...(hasBaseline && { legacyBaselinePath: baselinePath }),
            ...(hasChatBaseline && { legacyChatBaselinePath: chatBaselinePath }),
          }),
      ...(updateBaseline && { sourceCommit, updateBaseline }),
      manifest,
    });
  }

  const result = {
    agentPrompts: Object.fromEntries(
      scenarioIds.map((scenario) => [scenario.id, scenario.agentPrompt]),
    ),
    baselineAgentPrompt: HARNESS_AGENT_PROMPT,
    checks,
    error: failure instanceof Error ? failure.message : failure ? String(failure) : undefined,
    manifest,
    passed: !failure && checks.every((check) => check.status === 'PASS'),
    scenarioErrors,
  };
  const resultPath = path.join(runRoot, 'result.json');
  await writeFile(resultPath, JSON.stringify(result, null, 2));

  for (const check of checks) {
    console.log(`[${check.status}] ${check.id}: ${check.detail}`);
  }
  if (keep) console.log(`kept harness run at ${runRoot}`);
  if (failure) throw failure;
  if (!result.passed) process.exitCode = 1;
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
