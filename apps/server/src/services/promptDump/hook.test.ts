// @vitest-environment node
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { ChatMethodOptions, ChatStreamPayload } from '@lobechat/model-runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPromptDumpHook } from './hook';

let root: string;

const payload = (): ChatStreamPayload =>
  ({ messages: [{ content: 'hi', role: 'user' }], model: 'gpt-4o' }) as ChatStreamPayload;

const options = (extra: Record<string, unknown>): ChatMethodOptions =>
  extra as unknown as ChatMethodOptions;

/** The hook never blocks a call, so files land a tick later. */
const waitForFiles = async (bucket: string, count: number): Promise<string[]> => {
  let files: string[] = [];
  await vi.waitFor(async () => {
    files = (await readdir(path.join(root, bucket))).sort();
    expect(files).toHaveLength(count);
  });
  return files;
};

const readRecord = async (bucket: string, file: string) =>
  JSON.parse(await readFile(path.join(root, bucket, file), 'utf8'));

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'prompt-dump-hook-'));
  process.env.PROMPT_DUMP_ENABLED = '1';
  process.env.PROMPT_DUMP_PATH = root;
});

afterEach(async () => {
  delete process.env.PROMPT_DUMP_ENABLED;
  delete process.env.PROMPT_DUMP_PATH;
  await rm(root, { force: true, recursive: true });
});

describe('createPromptDumpHook', () => {
  it('adds no hooks while the deployment has not opted in', () => {
    delete process.env.PROMPT_DUMP_ENABLED;

    expect(createPromptDumpHook({ provider: 'openai' })).toEqual({});
  });

  it('mirrors the request and the provider usage report under one topic', async () => {
    const hook = createPromptDumpHook({ provider: 'openai', userId: 'user-1' });
    const call = payload();

    hook.beforeChat!(call, options({ metadata: { operationId: 'op-1', topicId: 'tpc_x' } }));
    hook.onChatFinal!(
      {
        finishReason: 'stop',
        text: 'ok',
        usage: { inputCachedTokens: 1200, totalInputTokens: 1500 },
      },
      { payload: call },
    );

    const files = await waitForFiles('tpc_x', 2);
    const request = await readRecord('tpc_x', files[0]!);
    const response = await readRecord('tpc_x', files[1]!);

    expect(request.operationId).toBe('op-1');
    expect(request.request.payload.messages).toEqual([{ content: 'hi', role: 'user' }]);
    expect(response.response.usage).toEqual({ inputCachedTokens: 1200, totalInputTokens: 1500 });
  });

  it('reads the topic from the client trace when the call metadata has none', async () => {
    const hook = createPromptDumpHook({ provider: 'openai' });
    const call = payload();

    hook.beforeChat!(call, options({ tracing: { topicId: 'tpc_traced' } }));

    await waitForFiles('tpc_traced', 1);
  });

  it('mirrors a call that failed before any output as an error file', async () => {
    const hook = createPromptDumpHook({ provider: 'openai' });
    const call = payload();

    hook.beforeChat!(call, options({ metadata: { topicId: 'tpc_err' } }));
    hook.onChatError!(new Error('boom') as never, { payload: call });

    const files = await waitForFiles('tpc_err', 2);
    const errorFile = files.find((file) => file.endsWith('-error.json'))!;
    const error = await readRecord('tpc_err', errorFile);

    expect(error.kind).toBe('error');
    expect(error.error.message).toBe('boom');
  });

  it('mirrors a stream that died after chat() returned', async () => {
    const hook = createPromptDumpHook({ provider: 'openai' });
    const call = payload();

    hook.beforeChat!(call, options({ metadata: { topicId: 'tpc_stream' } }));
    hook.onChatStreamError!(new Error('stream died'), { payload: call });

    await waitForFiles('tpc_stream', 2);
  });

  it('stamps the constructor trigger on runtimes built outside the init helpers', async () => {
    // Memory extraction builds its own adapter and passes no call metadata; the
    // mirror has to label those calls from the constructor instead.
    const hook = createPromptDumpHook({
      provider: 'opencodecodingplan',
      trigger: 'memory',
    });

    hook.beforeChat!(payload(), options({ metadata: { topicId: 'tpc_memory' } }));

    const files = await waitForFiles('tpc_memory', 1);
    const request = await readRecord('tpc_memory', files[0]!);

    expect(request.trigger).toBe('memory');
    expect(request.provider).toBe('opencodecodingplan');
  });

  it('lets call metadata outrank the constructor trigger', async () => {
    const hook = createPromptDumpHook({ provider: 'openai', trigger: 'memory' });

    await hook.beforeChat!(
      payload(),
      options({ metadata: { topicId: 'tpc_override', trigger: 'chat' } }),
    );

    const files = await waitForFiles('tpc_override', 1);

    expect((await readRecord('tpc_override', files[0]!)).trigger).toBe('chat');
  });
});
