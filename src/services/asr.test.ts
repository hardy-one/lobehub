import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: { asr: { transcribe: { mutate } } },
}));

const { asrService } = await import('./asr');

const inlineParams = {
  audioBase64: 'QUJDRA==',
  fileName: 'dictation.wav',
  language: 'zh',
  mimeType: 'audio/wav',
  model: 'mimo-v2.5-asr',
  provider: 'xiaomimimo',
};

beforeEach(() => {
  mutate.mockReset();
});

describe('asrService.transcribeAudio', () => {
  it('forwards inline audio to the asr router unchanged', async () => {
    mutate.mockResolvedValue({ text: '转写结果' });
    const signal = new AbortController().signal;

    await expect(asrService.transcribeAudio(inlineParams, signal)).resolves.toEqual({
      text: '转写结果',
    });
    expect(mutate).toHaveBeenCalledWith(inlineParams, { signal });
  });

  it('passes an undefined signal when the caller omits one', async () => {
    mutate.mockResolvedValue({ text: 'ok' });

    await asrService.transcribeAudio(inlineParams);

    expect(mutate).toHaveBeenCalledWith(inlineParams, { signal: undefined });
  });

  it('leaves the file-id path untouched', async () => {
    mutate.mockResolvedValue({ text: 'ok' });

    await asrService.transcribeFile({ fileId: 'file-1', model: 'whisper-1', provider: 'openai' });

    expect(mutate).toHaveBeenCalledWith(
      { fileId: 'file-1', model: 'whisper-1', provider: 'openai' },
      { signal: undefined },
    );
  });
});
