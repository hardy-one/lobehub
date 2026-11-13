import debug from 'debug';
import type OpenAI from 'openai';

import type { ASROptions, ASRPayload, ASRResponse } from '../../types/asr';
import type { ChatCompletionErrorPayload } from '../../types/type';

/** MiMo accepts only these two containers, identified by their MIME type. */
const SUPPORTED_AUDIO_TYPES: Record<string, string> = {
  'audio/mp3': 'audio/mpeg',
  'audio/mpeg': 'audio/mpeg',
  'audio/wav': 'audio/wav',
  'audio/wave': 'audio/wav',
  'audio/x-wav': 'audio/wav',
};

/** MiMo detects the language itself, and only pins it for Mandarin and English. */
const resolveLanguage = (language?: string): 'auto' | 'en' | 'zh' => {
  const value = language?.trim().toLowerCase();
  if (!value || value === 'auto') return 'auto';

  const primary = value.split(/[-_]/)[0];
  if (primary === 'zh' || primary === 'en') return primary;

  return 'auto';
};

const EXTENSION_TO_MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
};

/**
 * Pick the MIME type MiMo expects. The file name is consulted when the blob carries no
 * usable type, and anything outside wav / mp3 is rejected before the request is billed.
 */
export const resolveXiaomiMiMoAudioType = (file: Blob, fileName?: string): string => {
  const declared = SUPPORTED_AUDIO_TYPES[file.type?.toLowerCase()];
  if (declared) return declared;

  const extension = (fileName ?? (file instanceof File ? file.name : ''))
    .split('.')
    .pop()
    ?.toLowerCase();
  const fromName = extension ? EXTENSION_TO_MIME[extension] : undefined;
  if (fromName) return fromName;

  throw new Error(
    'MiMo speech recognition accepts wav and mp3 audio only; convert the file before transcribing it.',
  );
};

/**
 * Read the transcript out of the assistant message. Content is a plain string for this
 * model, but multipart content is unwrapped so a gateway answer still resolves.
 */
export const extractXiaomiMiMoTranscript = (response: unknown): string => {
  const content = (response as any)?.choices?.[0]?.message?.content;

  if (typeof content === 'string') return content.trim();

  if (Array.isArray(content)) {
    return content
      .map((part: any) => (typeof part === 'string' ? part : (part?.text ?? '')))
      .join('')
      .trim();
  }

  return '';
};

export interface XiaomiMiMoTranscriptionContext {
  handleError: (error: unknown) => ChatCompletionErrorPayload;
  logPrefix: string;
}

/**
 * `POST /chat/completions` with a base64 `input_audio` part, the shape MiMo uses for
 * speech recognition instead of `/audio/transcriptions`.
 * @see https://mimo.mi.com/docs/zh-CN/quick-start/usage-guide/audio/Speech-Recognition
 */
export const createXiaomiMiMoTranscription = async (
  client: OpenAI,
  payload: ASRPayload,
  options: ASROptions | undefined,
  context: XiaomiMiMoTranscriptionContext,
): Promise<ASRResponse> => {
  const log = debug(`${context.logPrefix}:transcribe`);
  const { file, fileName, language, model } = payload;

  log('transcribe called with model: %s, audio size: %d bytes', model, file?.size || 0);

  const mimeType = resolveXiaomiMiMoAudioType(file, fileName);
  const bytes = await file.arrayBuffer();
  const data = `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`;

  let response: unknown;
  try {
    response = await client.chat.completions.create(
      {
        asr_options: { language: resolveLanguage(language) },
        messages: [
          {
            content: [{ input_audio: { data }, type: 'input_audio' }],
            role: 'user',
          },
        ],
        model,
        stream: false,
      } as any,
      { headers: options?.headers, signal: options?.signal },
    );
  } catch (error) {
    throw context.handleError(error);
  }

  const text = extractXiaomiMiMoTranscript(response);
  if (!text) throw new Error('MiMo returned an empty transcript for this audio.');

  return { text };
};
