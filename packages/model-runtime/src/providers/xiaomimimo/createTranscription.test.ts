// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import {
  createXiaomiMiMoTranscription,
  extractXiaomiMiMoTranscript,
  resolveXiaomiMiMoAudioType,
} from './createTranscription';

const createContext = () => ({
  handleError: vi.fn((error: unknown) => error as any),
  logPrefix: 'test',
});

const createClient = (response: unknown) => ({
  chat: { completions: { create: vi.fn().mockResolvedValue(response) } },
});

const transcriptResponse = (content: unknown) => ({
  choices: [{ message: { content, role: 'assistant' } }],
});

describe('resolveXiaomiMiMoAudioType', () => {
  it('keeps declared wav and mp3 types', () => {
    expect(resolveXiaomiMiMoAudioType(new Blob([], { type: 'audio/wav' }))).toBe('audio/wav');
    expect(resolveXiaomiMiMoAudioType(new Blob([], { type: 'audio/mp3' }))).toBe('audio/mpeg');
  });

  it('infers the type from the file name when the blob has none', () => {
    expect(resolveXiaomiMiMoAudioType(new Blob([]), 'meeting.mp3')).toBe('audio/mpeg');
  });

  it('rejects containers MiMo does not accept', () => {
    expect(() => resolveXiaomiMiMoAudioType(new Blob([], { type: 'audio/m4a' }))).toThrow(
      /accepts wav and mp3 audio only/,
    );
  });
});

describe('extractXiaomiMiMoTranscript', () => {
  it('reads a plain string answer', () => {
    expect(extractXiaomiMiMoTranscript(transcriptResponse('  你好世界  '))).toBe('你好世界');
  });

  it('joins multipart content', () => {
    expect(
      extractXiaomiMiMoTranscript(transcriptResponse([{ text: '你好' }, { text: '，世界' }])),
    ).toBe('你好，世界');
  });

  it('returns an empty string when the message has no content', () => {
    expect(extractXiaomiMiMoTranscript({ choices: [] })).toBe('');
  });
});

describe('createXiaomiMiMoTranscription', () => {
  it('sends the audio as a base64 data URL in a user message', async () => {
    const client = createClient(transcriptResponse('你好世界'));

    const result = await createXiaomiMiMoTranscription(
      client as any,
      {
        fileName: 'speech.wav',
        file: new Blob(['audio-bytes'], { type: 'audio/wav' }),
        language: 'zh-CN',
        model: 'mimo-v2.5-asr',
      },
      undefined,
      createContext(),
    );

    const body = client.chat.completions.create.mock.calls[0][0];
    expect(body.model).toBe('mimo-v2.5-asr');
    expect(body.stream).toBe(false);
    expect(body.asr_options).toEqual({ language: 'zh' });
    expect(body.messages).toEqual([
      {
        content: [
          {
            input_audio: {
              data: `data:audio/wav;base64,${Buffer.from('audio-bytes').toString('base64')}`,
            },
            type: 'input_audio',
          },
        ],
        role: 'user',
      },
    ]);
    expect(result).toEqual({ text: '你好世界' });
  });

  it('falls back to auto detection for unsupported languages', async () => {
    const client = createClient(transcriptResponse('bonjour'));

    await createXiaomiMiMoTranscription(
      client as any,
      {
        file: new Blob(['x'], { type: 'audio/mpeg' }),
        language: 'fr',
        model: 'mimo-v2.5-asr',
      },
      undefined,
      createContext(),
    );

    expect(client.chat.completions.create.mock.calls[0][0].asr_options).toEqual({
      language: 'auto',
    });
  });

  it('rejects unsupported audio before calling the API', async () => {
    const client = createClient(transcriptResponse('unused'));

    await expect(
      createXiaomiMiMoTranscription(
        client as any,
        { file: new Blob(['x'], { type: 'audio/m4a' }), model: 'mimo-v2.5-asr' },
        undefined,
        createContext(),
      ),
    ).rejects.toThrow(/accepts wav and mp3 audio only/);

    expect(client.chat.completions.create).not.toHaveBeenCalled();
  });

  it('fails on an empty transcript', async () => {
    const client = createClient(transcriptResponse(''));

    await expect(
      createXiaomiMiMoTranscription(
        client as any,
        { file: new Blob(['x'], { type: 'audio/wav' }), model: 'mimo-v2.5-asr' },
        undefined,
        createContext(),
      ),
    ).rejects.toThrow(/empty transcript/);
  });

  it('maps upstream failures through handleError', async () => {
    const error = new Error('upstream failed');
    const client = { chat: { completions: { create: vi.fn().mockRejectedValue(error) } } };
    const context = createContext();

    await expect(
      createXiaomiMiMoTranscription(
        client as any,
        { file: new Blob(['x'], { type: 'audio/wav' }), model: 'mimo-v2.5-asr' },
        undefined,
        context,
      ),
    ).rejects.toBe(error);

    expect(context.handleError).toHaveBeenCalledWith(error);
  });
});
