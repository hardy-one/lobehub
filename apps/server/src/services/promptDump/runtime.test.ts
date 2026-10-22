// @vitest-environment node
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { ChatStreamPayload, LobeRuntimeAI, OnFinishData } from '@lobechat/model-runtime';
import { ModelRuntime } from '@lobechat/model-runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPromptDumpHook } from './hook';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'prompt-dump-runtime-'));
  process.env.PROMPT_DUMP_ENABLED = '1';
  process.env.PROMPT_DUMP_PATH = root;
});

afterEach(async () => {
  delete process.env.PROMPT_DUMP_ENABLED;
  delete process.env.PROMPT_DUMP_PATH;
  await rm(root, { force: true, recursive: true });
});

/**
 * Pins the assumption the hook's correlation rests on: `ModelRuntime` hands the
 * same `payload` reference to `beforeChat` and to the terminal hooks, and it
 * only creates the `callback.onFinal` the provider calls when `onChatFinal` is
 * present. Both would silently stop mirroring if `ModelRuntime.chat` changed.
 */
describe('prompt dump through ModelRuntime', () => {
  it('mirrors the request and the completion of a real chat call', async () => {
    const completion: OnFinishData = {
      finishReason: 'stop',
      text: 'ok',
      usage: { inputCachedTokens: 900, totalInputTokens: 1000 } as OnFinishData['usage'],
    };
    const runtime = {
      chat: async (_payload: ChatStreamPayload, options) => {
        await options?.callback?.onFinal?.(completion);
        return new Response('');
      },
    } as unknown as LobeRuntimeAI;

    const modelRuntime = new ModelRuntime(runtime, createPromptDumpHook({ provider: 'openai' }));
    await modelRuntime.chat(
      { messages: [{ content: 'hi', role: 'user' }], model: 'gpt-4o' } as ChatStreamPayload,
      { metadata: { operationId: 'op-1', topicId: 'tpc_it' } },
    );

    let files: string[] = [];
    await vi.waitFor(async () => {
      files = (await readdir(path.join(root, 'tpc_it'))).sort();
      expect(files).toHaveLength(2);
    });

    const requestFile = files.find((file) => file.endsWith('-request.json'))!;
    const responseFile = files.find((file) => file.endsWith('-response.json'))!;
    const request = JSON.parse(await readFile(path.join(root, 'tpc_it', requestFile), 'utf8'));
    const response = JSON.parse(await readFile(path.join(root, 'tpc_it', responseFile), 'utf8'));

    expect(request.operationId).toBe('op-1');
    expect(request.request.payload).toMatchObject({ model: 'gpt-4o' });
    expect(response.response.usage).toEqual({ inputCachedTokens: 900, totalInputTokens: 1000 });
  });
});

/**
 * Extraction paths build their adapter with `initializeWithProviderHooks`, which
 * hands the factory the provider it is about to use. Pinning it here keeps that
 * one guarantee — the mirror names the endpoint the request reached — from
 * silently degrading to `unknown` when the signature changes.
 */
describe('prompt dump through initializeWithProviderHooks', () => {
  it('gives the factory the provider and keeps the hook stack it returns', async () => {
    const seen: string[] = [];
    const completion: OnFinishData = {
      finishReason: 'stop',
      text: 'ok',
      usage: { inputCachedTokens: 10, totalInputTokens: 20 } as OnFinishData['usage'],
    };

    const modelRuntime = ModelRuntime.initializeWithProviderHooks(
      'openai',
      { apiKey: 'test-key' },
      ({ provider }) => {
        seen.push(provider);

        return createPromptDumpHook({ provider, trigger: 'memory' });
      },
    );

    // The provider adapter would reach the network; the mirror only needs `chat`
    // to hand the payload to the hooks, so stub the transport at the top.
    const runtimeAI = (modelRuntime as unknown as { _runtime: LobeRuntimeAI })._runtime;
    vi.spyOn(runtimeAI, 'chat').mockImplementation(async (_payload, options) => {
      await options?.callback?.onFinal?.(completion);
      return new Response('');
    });

    await modelRuntime.chat(
      { messages: [{ content: 'hi', role: 'user' }], model: 'gpt-4o' } as ChatStreamPayload,
      { metadata: { topicId: 'tpc_hooks' } },
    );

    let files: string[] = [];
    await vi.waitFor(async () => {
      files = (await readdir(path.join(root, 'tpc_hooks'))).sort();
      expect(files).toHaveLength(2);
    });

    const request = JSON.parse(await readFile(path.join(root, 'tpc_hooks', files[0]!), 'utf8'));

    expect(seen).toEqual(['openai']);
    expect(request.provider).toBe('openai');
    expect(request.trigger).toBe('memory');
  });
});
