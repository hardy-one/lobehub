import { resolveAsrModel } from '@/features/ChatInput/Dictation/resolveAsrModel';
import { asrService } from '@/services/asr';

/**
 * Turn an uploaded voice recording into the text of its turn.
 *
 * Heterogeneous agents (Claude Code, Codex, …) only take a text prompt, so a voice turn is sent
 * as its transcript. The recording stays attached for playback, but the transcript is what gets
 * persisted as the user message content and what the external CLI receives.
 */
export const transcribeVoiceMessage = async (fileId: string, signal?: AbortSignal) => {
  let model: string;
  let provider: string;

  try {
    ({ model, provider } = resolveAsrModel());
  } catch {
    // The transcript is chat content, not a dictation error card: keep the message the chat
    // send path has always surfaced instead of leaking the dictation error code.
    throw new Error('No speech-to-text model is configured');
  }

  const { text } = await asrService.transcribeFile({ fileId, model, provider }, signal);

  const transcript = text.trim();
  if (!transcript) throw new Error('Voice message transcript is empty');

  return transcript;
};
