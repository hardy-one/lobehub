import type { ChatAudioItem } from '@lobechat/types';

/**
 * A transcribed voice turn keeps its recording for playback only: the transcript is already
 * the message text. Everything that mirrors what the model receives — request content and
 * token accounting alike — must read the audio list through here, or the recording is
 * described and budgeted a second time.
 */
export const getModelVisibleAudioList = (message: {
  audioList?: ChatAudioItem[];
  metadata?: { voiceMessage?: { transcribed?: boolean } } | null;
}): ChatAudioItem[] =>
  message.metadata?.voiceMessage?.transcribed ? [] : (message.audioList ?? []);
