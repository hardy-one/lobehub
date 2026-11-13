import debug from 'debug';
import type OpenAI from 'openai';

import type {
  TextToSpeechOptions,
  TextToSpeechPayload,
  TextToSpeechResponse,
} from '../../types/tts';
import { resolveTextToSpeechParams } from '../../types/tts';
import type { ChatCompletionErrorPayload } from '../../types/type';

/**
 * MiMo answers every non-streaming synthesis with a wav container, so the caller's
 * `format` is not forwarded and the response reports wav.
 */
export const XIAOMIMIMO_SPEECH_FORMAT = 'wav' as const;

export const XIAOMIMIMO_VOICE_DESIGN_MODEL = 'mimo-v2.5-tts-voicedesign';
export const XIAOMIMIMO_VOICE_CLONE_MODEL = 'mimo-v2.5-tts-voiceclone';
export const XIAOMIMIMO_DEFAULT_VOICE = 'mimo_default';

/** Voice cloning carries the sample itself as the voice, so the field must be a data URL. */
const AUDIO_DATA_URL = /^data:audio\/(?:mpeg|mp3|wav|wave|x-wav);base64,/i;

export interface XiaomiMiMoSpeechContext {
  handleError: (error: unknown) => ChatCompletionErrorPayload;
  logPrefix: string;
}

interface SpeechMessage {
  content: string;
  role: 'assistant' | 'user';
}

/**
 * MiMo wants the text to speak in the assistant message and the style direction in an
 * optional user message. Voice design replaces the preset voice with that direction.
 */
const buildSpeechMessages = (
  model: string,
  input: string,
  instructions?: string,
): SpeechMessage[] => {
  const style = instructions?.trim();
  const messages: SpeechMessage[] = [];

  if (model === XIAOMIMIMO_VOICE_DESIGN_MODEL) {
    if (!style) {
      throw new Error(
        `${XIAOMIMIMO_VOICE_DESIGN_MODEL} derives its voice from a text description; pass one in instructions.`,
      );
    }
    messages.push({ role: 'user', content: style });
  } else if (style) {
    messages.push({ role: 'user', content: style });
  }

  messages.push({ role: 'assistant', content: input });

  return messages;
};

/**
 * Resolve the voice sent in `audio.voice`. Preset models fall back to the cluster default
 * when the caller left the field empty, and voice cloning rejects anything that is not an
 * audio data URL instead of failing upstream with a vague 400.
 */
const resolveSpeechVoice = (model: string, voice?: string): string | undefined => {
  if (model === XIAOMIMIMO_VOICE_DESIGN_MODEL) return undefined;

  const value = voice?.trim();

  if (model === XIAOMIMIMO_VOICE_CLONE_MODEL) {
    if (!value || !AUDIO_DATA_URL.test(value)) {
      throw new Error(
        `${XIAOMIMIMO_VOICE_CLONE_MODEL} needs a wav or mp3 sample as the voice: pass a \`data:audio/wav;base64,...\` or \`data:audio/mpeg;base64,...\` URL, base64 payload at most 10 MB.`,
      );
    }

    return value;
  }

  return value || XIAOMIMIMO_DEFAULT_VOICE;
};

/**
 * Decode the base64 audio MiMo returns in the assistant message.
 */
export const extractXiaomiMiMoAudio = (response: unknown): string | undefined => {
  const data = (response as any)?.choices?.[0]?.message?.audio?.data;

  return typeof data === 'string' && data.length > 0 ? data : undefined;
};

export const toArrayBuffer = (buffer: Buffer): ArrayBuffer =>
  buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;

/**
 * `POST /chat/completions` with a top-level `audio` argument, the shape MiMo uses for
 * speech synthesis instead of `/audio/speech`.
 * @see https://mimo.mi.com/docs/zh-CN/quick-start/usage-guide/audio/speech-synthesis-v2.5
 */
export const createXiaomiMiMoSpeech = async (
  client: OpenAI,
  payload: TextToSpeechPayload,
  options: TextToSpeechOptions | undefined,
  context: XiaomiMiMoSpeechContext,
): Promise<TextToSpeechResponse> => {
  const log = debug(`${context.logPrefix}:textToSpeech`);
  const params = resolveTextToSpeechParams(payload);

  log(
    'textToSpeech called with model: %s, input length: %d, voice: %s',
    payload.model,
    payload.input.length,
    payload.voice,
  );

  const messages = buildSpeechMessages(payload.model, payload.input, params.instructions);
  const voice = resolveSpeechVoice(payload.model, payload.voice);

  let audioBase64: string | undefined;
  try {
    const response = await client.chat.completions.create(
      {
        audio: { format: XIAOMIMIMO_SPEECH_FORMAT, ...(voice && { voice }) },
        messages,
        model: payload.model,
        stream: false,
      } as any,
      { headers: options?.headers, signal: options?.signal },
    );

    audioBase64 = extractXiaomiMiMoAudio(response);
  } catch (error) {
    throw context.handleError(error);
  }

  if (!audioBase64) throw new Error('MiMo returned no audio for this synthesis request.');

  const audio = toArrayBuffer(Buffer.from(audioBase64, 'base64'));
  log('generated audio with size: %d bytes', audio.byteLength);

  // The three MiMo speech models are free of charge for now, so there is no usage to settle.
  return { audio, format: XIAOMIMIMO_SPEECH_FORMAT };
};
