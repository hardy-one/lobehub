import { getUserStoreState } from '@/store/user';
import { systemAgentSelectors } from '@/store/user/selectors';

import { RealtimeDictationError } from './contract';

/**
 * Resolve the speech-to-text model configured in settings. Shared by the voice message path
 * and dictation, so one setting drives both.
 *
 * Throws `PROVIDER_NOT_CONFIGURED` rather than a bare string: `clientErrors.ts#toClientError`
 * only maps this type, and everything else degrades to `AUDIO_CAPTURE_FAILED` — which would
 * tell the user their microphone failed when the real problem is a missing model.
 */
export const resolveAsrModel = (): { model: string; provider: string } => {
  const { model, provider } = systemAgentSelectors.asr(getUserStoreState());

  if (!model || !provider) throw new RealtimeDictationError('PROVIDER_NOT_CONFIGURED', false);

  return { model, provider };
};
