// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { XIAOMIMIMO_MAX_BASE64_BYTES } from './audioLimits';
import { createXiaomiMiMoSpeech, XIAOMIMIMO_SPEECH_FORMAT } from './createSpeech';

const encode = (text: string) => Buffer.from(text).toString('base64');

const createContext = () => ({
  handleError: vi.fn((error: unknown) => error as any),
  logPrefix: 'test',
});

const createClient = (response: unknown) => ({
  chat: { completions: { create: vi.fn().mockResolvedValue(response) } },
});

const audioResponse = (audio = encode('wav-bytes')) => ({
  choices: [{ message: { audio: { data: audio }, role: 'assistant' } }],
});

describe('createXiaomiMiMoSpeech', () => {
  it('sends the text in the assistant message and asks for wav', async () => {
    const client = createClient(audioResponse());
    const context = createContext();

    const result = await createXiaomiMiMoSpeech(
      client as any,
      { input: '你好', model: 'mimo-v2.5-tts', voice: 'Chloe' },
      undefined,
      context,
    );

    const body = client.chat.completions.create.mock.calls[0][0];
    expect(body.model).toBe('mimo-v2.5-tts');
    expect(body.stream).toBe(false);
    expect(body.audio).toEqual({ format: 'wav', voice: 'Chloe' });
    expect(body.messages).toEqual([{ content: '你好', role: 'assistant' }]);

    expect(result.format).toBe(XIAOMIMIMO_SPEECH_FORMAT);
    expect(Buffer.from(result.audio).toString()).toBe('wav-bytes');
  });

  it('adds a user message carrying the style instruction', async () => {
    const client = createClient(audioResponse());

    await createXiaomiMiMoSpeech(
      client as any,
      {
        input: 'hello',
        model: 'mimo-v2.5-tts',
        params: { instructions: '  语速稍快  ' },
        voice: 'Mia',
      },
      undefined,
      createContext(),
    );

    const body = client.chat.completions.create.mock.calls[0][0];
    expect(body.messages).toEqual([
      { content: '语速稍快', role: 'user' },
      { content: 'hello', role: 'assistant' },
    ]);
  });

  it('falls back to the cluster default voice when none was requested', async () => {
    const client = createClient(audioResponse());

    await createXiaomiMiMoSpeech(
      client as any,
      { input: 'hi', model: 'mimo-v2.5-tts', voice: '' },
      undefined,
      createContext(),
    );

    expect(client.chat.completions.create.mock.calls[0][0].audio.voice).toBe('mimo_default');
  });

  it('sends the voice description as the user message for voice design', async () => {
    const client = createClient(audioResponse());

    await createXiaomiMiMoSpeech(
      client as any,
      {
        input: '晚安',
        model: 'mimo-v2.5-tts-voicedesign',
        params: { instructions: '温柔治愈的年轻女声' },
        voice: 'alloy',
      },
      undefined,
      createContext(),
    );

    const body = client.chat.completions.create.mock.calls[0][0];
    expect(body.audio).toEqual({ format: 'wav' });
    expect(body.messages).toEqual([
      { content: '温柔治愈的年轻女声', role: 'user' },
      { content: '晚安', role: 'assistant' },
    ]);
  });

  it('rejects voice design without a description', async () => {
    const client = createClient(audioResponse());

    await expect(
      createXiaomiMiMoSpeech(
        client as any,
        { input: '晚安', model: 'mimo-v2.5-tts-voicedesign', voice: 'alloy' },
        undefined,
        createContext(),
      ),
    ).rejects.toThrow(/derives its voice from a text description/);

    expect(client.chat.completions.create).not.toHaveBeenCalled();
  });

  it('passes a data URL sample through for voice cloning', async () => {
    const client = createClient(audioResponse());
    const sample = `data:audio/mpeg;base64,${encode('sample')}`;

    await createXiaomiMiMoSpeech(
      client as any,
      { input: 'hi', model: 'mimo-v2.5-tts-voiceclone', voice: sample },
      undefined,
      createContext(),
    );

    expect(client.chat.completions.create.mock.calls[0][0].audio.voice).toBe(sample);
  });

  it('rejects a voice clone request whose voice is not an audio data URL', async () => {
    const client = createClient(audioResponse());

    await expect(
      createXiaomiMiMoSpeech(
        client as any,
        { input: 'hi', model: 'mimo-v2.5-tts-voiceclone', voice: 'alloy' },
        undefined,
        createContext(),
      ),
    ).rejects.toThrow(/needs a wav or mp3 sample as the voice/);

    expect(client.chat.completions.create).not.toHaveBeenCalled();
  });

  it('forwards the abort signal and headers', async () => {
    const client = createClient(audioResponse());
    const signal = new AbortController().signal;

    await createXiaomiMiMoSpeech(
      client as any,
      { input: 'hi', model: 'mimo-v2.5-tts', voice: 'Mia' },
      { headers: { 'x-test': '1' }, signal },
      createContext(),
    );

    expect(client.chat.completions.create.mock.calls[0][1]).toEqual({
      headers: { 'x-test': '1' },
      signal,
    });
  });

  it('fails when the response carries no audio', async () => {
    const client = createClient({ choices: [{ message: { content: 'no audio' } }] });

    await expect(
      createXiaomiMiMoSpeech(
        client as any,
        { input: 'hi', model: 'mimo-v2.5-tts', voice: 'Mia' },
        undefined,
        createContext(),
      ),
    ).rejects.toThrow(/returned no audio/);
  });

  it('maps upstream failures through handleError', async () => {
    const error = new Error('upstream failed');
    const client = { chat: { completions: { create: vi.fn().mockRejectedValue(error) } } };
    const context = createContext();

    await expect(
      createXiaomiMiMoSpeech(
        client as any,
        { input: 'hi', model: 'mimo-v2.5-tts', voice: 'Mia' },
        undefined,
        context,
      ),
    ).rejects.toBe(error);

    expect(context.handleError).toHaveBeenCalledWith(error);
  });
});

describe('createXiaomiMiMoSpeech - voice sample limit', () => {
  const sampleOf = (base64Length: number) => `data:audio/wav;base64,${'A'.repeat(base64Length)}`;

  it('accepts a sample that fills the documented payload exactly', async () => {
    const client = createClient(audioResponse());

    await createXiaomiMiMoSpeech(
      client as any,
      {
        input: 'hi',
        model: 'mimo-v2.5-tts-voiceclone',
        voice: sampleOf(XIAOMIMIMO_MAX_BASE64_BYTES),
      },
      undefined,
      createContext(),
    );

    expect(client.chat.completions.create).toHaveBeenCalledTimes(1);
  });

  it('rejects a sample past the limit before calling the API', async () => {
    const client = createClient(audioResponse());

    await expect(
      createXiaomiMiMoSpeech(
        client as any,
        {
          input: 'hi',
          model: 'mimo-v2.5-tts-voiceclone',
          voice: sampleOf(XIAOMIMIMO_MAX_BASE64_BYTES + 4),
        },
        undefined,
        createContext(),
      ),
    ).rejects.toThrow(/at most 10 MB of base64 audio per voice-clone sample/);

    expect(client.chat.completions.create).not.toHaveBeenCalled();
  });
});
