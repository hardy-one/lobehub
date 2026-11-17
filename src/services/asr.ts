import { lambdaClient } from '@/libs/trpc/client';

export interface TranscribeFileParams {
  fileId: string;
  language?: string;
  model: string;
  provider: string;
}

export interface TranscribeAudioParams {
  /** Base64-encoded audio bytes. The server caps the decoded payload at 3MB. */
  audioBase64: string;
  fileName: string;
  language?: string;
  mimeType: string;
  model: string;
  provider: string;
}

class AsrService {
  transcribeFile = (params: TranscribeFileParams, signal?: AbortSignal) =>
    lambdaClient.asr.transcribe.mutate(params, { signal });

  /**
   * Transcribe audio that lives in memory instead of storage. One-shot dictation uses this
   * so the recording never becomes a stored file that then needs cleanup.
   */
  transcribeAudio = (params: TranscribeAudioParams, signal?: AbortSignal) =>
    lambdaClient.asr.transcribe.mutate(params, { signal });
}

export const asrService = new AsrService();
