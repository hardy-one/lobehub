import type { ChatAudioItem, UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../types';
import { MessageContentProcessor } from './MessageContent';

const createContext = (messages: UIChatMessage[]): PipelineContext => ({
  initialState: { messages: [] } as any,
  messages,
  metadata: { model: 'gpt-4', provider: 'openai', maxTokens: 100000 },
  isAborted: false,
});

const createProcessor = (isCanUseAudio: boolean) =>
  new MessageContentProcessor({
    model: 'gpt-4',
    provider: 'openai',
    isCanUseAudio: () => isCanUseAudio,
    fileContext: { enabled: true, includeFileUrl: true },
  });

const createVoiceMessage = (metadata?: UIChatMessage['metadata']): UIChatMessage => ({
  id: 'voice-1',
  role: 'user',
  content: '你好，我在测试语音功能正不正常？',
  audioList: [
    { alt: 'Voice message', id: 'audio-1', url: 'http://example.com/a.mp3' } as ChatAudioItem,
  ],
  createdAt: Date.now(),
  metadata,
  updatedAt: Date.now(),
});

describe('MessageContentProcessor voice messages', () => {
  it('drops a transcribed recording from the request', async () => {
    const result = await createProcessor(false).process(
      createContext([createVoiceMessage({ voiceMessage: { transcribed: true } })]),
    );

    // The transcript already answers the turn, so neither an audio part nor the
    // `<audios>` reference that leads to `analyzeMedia` may reach the model.
    expect(result.messages[0].content).toBe('你好，我在测试语音功能正不正常？');
  });

  it('keeps a recording that has not been transcribed in the file context', async () => {
    const result = await createProcessor(false).process(createContext([createVoiceMessage()]));

    // The audio-only fallback: the model cannot hear the recording, so the
    // reference stays available for `analyzeMedia`.
    const content = result.messages[0].content as any[];
    expect(content[0].text).toContain('<audios>');
    expect(content.some((part) => part.type === 'audio_url')).toBe(false);
  });
});
