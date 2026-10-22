// @vitest-environment node
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { ChatStreamPayload } from '@lobechat/model-runtime';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PromptDumpService, resolveTopicBucket } from './index';

let root: string;

const payload = (overrides: Partial<ChatStreamPayload> = {}): ChatStreamPayload =>
  ({
    messages: [{ content: 'hi', role: 'user' }],
    model: 'gpt-4o',
    ...overrides,
  }) as ChatStreamPayload;

const listBucket = async (bucket: string): Promise<string[]> =>
  (await readdir(path.join(root, bucket))).sort();

const readJson = async <T>(bucket: string, file: string): Promise<T> =>
  JSON.parse(await readFile(path.join(root, bucket, file), 'utf8')) as T;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'prompt-dump-'));
  process.env.PROMPT_DUMP_ENABLED = '1';
  process.env.PROMPT_DUMP_PATH = root;
});

afterEach(async () => {
  delete process.env.PROMPT_DUMP_ENABLED;
  delete process.env.PROMPT_DUMP_PATH;
  await rm(root, { force: true, recursive: true });
});

describe('resolveTopicBucket', () => {
  it('keeps a well-formed topic id as the bucket name', () => {
    expect(resolveTopicBucket('tpc_abc-123')).toBe('tpc_abc-123');
  });

  it('reduces a topic id to a single safe path segment', () => {
    expect(resolveTopicBucket('../../etc/pa ss')).toBe('etc_pa_ss');
  });

  it('files a call without a topic under the no-topic bucket', () => {
    expect(resolveTopicBucket(undefined)).toBe('_no-topic');
    expect(resolveTopicBucket('   ')).toBe('_no-topic');
    expect(resolveTopicBucket('///')).toBe('_no-topic');
  });
});

describe('PromptDumpService', () => {
  it('records nothing while the deployment has not opted in', async () => {
    delete process.env.PROMPT_DUMP_ENABLED;

    expect(new PromptDumpService().beginCall({ provider: 'openai' })).toBeNull();
    expect(await readdir(root)).toEqual([]);
  });

  it('mirrors the assembled request under its topic, with a fingerprint', async () => {
    const recorder = new PromptDumpService().beginCall({
      operationId: 'op-1',
      provider: 'openai',
      topicId: 'tpc_abc',
    });

    await recorder!.recordRequest(payload({ tools: [], temperature: 0.3 }));

    const [file] = await listBucket('tpc_abc');
    expect(file).toMatch(/^\d+-[0-9a-f]{8}-request\.json$/);

    const record = await readJson<{
      kind: string;
      operationId: string;
      provider: string;
      request: { fingerprint: string; payload: ChatStreamPayload };
      topicId: string;
    }>('tpc_abc', file);

    expect(record.kind).toBe('request');
    expect(record.provider).toBe('openai');
    expect(record.operationId).toBe('op-1');
    expect(record.topicId).toBe('tpc_abc');
    expect(record.request.payload.messages).toEqual([{ content: 'hi', role: 'user' }]);
    expect(record.request.payload.temperature).toBe(0.3);
    expect(record.request.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('pairs the response with the request under one sortable prefix', async () => {
    const recorder = new PromptDumpService().beginCall({ provider: 'openai', topicId: 'tpc_abc' });

    await recorder!.recordRequest(payload());
    await recorder!.recordResponse({ finishReason: 'stop', text: 'hello', usage: {} } as never);

    const files = await listBucket('tpc_abc');
    expect(files).toHaveLength(2);
    expect(files[0]!.replace('-request.json', '')).toBe(files[1]!.replace('-response.json', ''));
    expect(files[0]!.endsWith('-request.json')).toBe(true);
    expect(files[1]!.endsWith('-response.json')).toBe(true);
  });

  it('files calls without a topic under the no-topic bucket', async () => {
    const recorder = new PromptDumpService().beginCall({ provider: 'openai' });

    await recorder!.recordRequest(payload());

    expect(await listBucket('_no-topic')).toHaveLength(1);
  });

  it('writes the payload verbatim, inline base64 images included', async () => {
    const image = `data:image/png;base64,${'A'.repeat(2000)}`;

    const recorder = new PromptDumpService().beginCall({ provider: 'openai', topicId: 'tpc_img' });
    await recorder!.recordRequest(payload({ messages: [{ content: image, role: 'user' }] }));

    const [file] = await listBucket('tpc_img');
    const raw = await readFile(path.join(root, 'tpc_img', file!), 'utf8');

    expect(raw).toContain(image);
  });

  it('fingerprints the mirrored body, so identical payloads compare equal', async () => {
    const same = () => new PromptDumpService().beginCall({ provider: 'openai', topicId: 'tpc_fp' });
    const body = payload({ messages: [{ content: 'same input', role: 'user' }] });

    await same()!.recordRequest(body);
    await same()!.recordRequest(payload({ messages: [{ content: 'same input', role: 'user' }] }));

    const files = await listBucket('tpc_fp');
    const fingerprints = await Promise.all(
      files.map(
        async (file) =>
          JSON.parse(await readFile(path.join(root, 'tpc_fp', file), 'utf8')).request.fingerprint,
      ),
    );

    expect(fingerprints[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprints[0]).toBe(fingerprints[1]);
  });

  it('keeps an object reused at several paths intact at every path', async () => {
    // Tool schemas share one enum array across definitions; the mirror must not
    // mistake sharing for a cycle and swallow the repeats.
    const sharedEnum = ['activity', 'context'];
    const schema = (name: string) => ({
      function: { name, parameters: { properties: { memoryType: { enum: sharedEnum } } } },
    });

    const recorder = new PromptDumpService().beginCall({ provider: 'openai', topicId: 'tpc_dag' });
    await recorder!.recordRequest(
      payload({ tools: [schema('one'), schema('two'), schema('three')] as never }),
    );

    const [file] = await listBucket('tpc_dag');
    const raw = await readFile(path.join(root, 'tpc_dag', file!), 'utf8');
    const tools = JSON.parse(raw).request.payload.tools;

    expect(tools[0].function.parameters.properties.memoryType.enum).toEqual([
      'activity',
      'context',
    ]);
    expect(tools[2].function.parameters.properties.memoryType.enum).toEqual([
      'activity',
      'context',
    ]);
    expect(raw).not.toContain('[circular]');
  });

  it('still records the call when the payload cannot be serialised at all', async () => {
    // A circular payload can never reach a provider; the mirror must still name
    // the call instead of losing it.
    const cyclic: Record<string, unknown> = { stage: 'loop' };
    cyclic.self = cyclic;

    const recorder = new PromptDumpService().beginCall({
      provider: 'openai',
      topicId: 'tpc_cycle',
    });
    await recorder!.recordRequest(
      payload({ messages: [{ content: 'hi', cyclic, role: 'user' }] as never }),
    );

    const [file] = await listBucket('tpc_cycle');
    const record = JSON.parse(await readFile(path.join(root, 'tpc_cycle', file!), 'utf8'));

    expect(record.kind).toBe('request');
    expect(record.provider).toBe('openai');
    expect(record.request.payload.messages[0].cyclic.self).toBe('[circular]');
  });

  it('records a failed call as its own file so the request is never lost', async () => {
    const recorder = new PromptDumpService().beginCall({ provider: 'openai', topicId: 'tpc_err' });

    await recorder!.recordRequest(payload());
    await recorder!.recordError(new Error('provider exploded'));

    const files = await listBucket('tpc_err');
    const errorFile = files.find((file) => file.endsWith('-error.json'))!;
    const record = await readJson<{ error: { message: string }; kind: string }>(
      'tpc_err',
      errorFile,
    );

    expect(record.kind).toBe('error');
    expect(record.error.message).toBe('provider exploded');
    expect(files.some((file) => file.endsWith('-request.json'))).toBe(true);
  });
});
