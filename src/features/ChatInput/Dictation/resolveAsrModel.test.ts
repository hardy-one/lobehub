import { DEFAULT_ASR_MODEL, DEFAULT_ASR_PROVIDER } from '@lobechat/business-const';
import { afterEach, describe, expect, it } from 'vitest';

import { useUserStore } from '@/store/user';

import { RealtimeDictationError } from './contract';
import { resolveAsrModel } from './resolveAsrModel';

const initialUserState = useUserStore.getState();

const setAsr = (asr: { model: string; provider: string }) =>
  useUserStore.setState({ settings: { systemAgent: { asr } } } as any);

afterEach(() => {
  useUserStore.setState(initialUserState, true);
});

describe('resolveAsrModel', () => {
  it('returns the model and provider configured in settings', () => {
    setAsr({ model: 'gpt-4o-mini-transcribe', provider: 'lobehub' });

    expect(resolveAsrModel()).toEqual({ model: 'gpt-4o-mini-transcribe', provider: 'lobehub' });
  });

  it('falls back to the default STT model when the preference is unset', () => {
    expect(resolveAsrModel()).toEqual({
      model: DEFAULT_ASR_MODEL,
      provider: DEFAULT_ASR_PROVIDER,
    });
  });

  // A bare Error would be mapped to AUDIO_CAPTURE_FAILED by clientErrors.ts#toClientError,
  // blaming the microphone for what is really a missing model.
  it('throws PROVIDER_NOT_CONFIGURED once the model is cleared', () => {
    setAsr({ model: '', provider: '' });

    expect(() => resolveAsrModel()).toThrow(RealtimeDictationError);

    try {
      resolveAsrModel();
    } catch (error) {
      expect(error).toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED', retryable: false });
    }
  });
});
