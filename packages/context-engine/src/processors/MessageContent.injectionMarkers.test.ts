import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import type { PipelineContext } from '../types';
import { MessageContentProcessor, VISION_DOWNGRADE_PLACEHOLDER } from './MessageContent';

const createContext = (messages: UIChatMessage[]): PipelineContext => ({
  initialState: { messages: [] } as any,
  isAborted: false,
  messages,
  metadata: { model: 'gpt-4', provider: 'openai', maxTokens: 100_000 },
});

const injectionContent = 'injected {{topic_id}} memo  🏷️ ';

const injectionRow = (): UIChatMessage =>
  ({
    content: [
      { text: injectionContent, type: 'text' },
      { image_url: { url: 'https://files.example.com/diagram.png' }, type: 'image_url' },
    ],
    createdAt: Date.now(),
    id: 'inj-1',
    isInjection: true,
    parentId: 'u-0',
    role: 'user',
    sourceKey: 'agent-document-message',
    updatedAt: Date.now(),
  }) as UIChatMessage;

const createProcessor = (canUseVision: boolean) =>
  new MessageContentProcessor({
    fileContext: { enabled: false },
    isCanUseAudio: () => false,
    isCanUseVideo: () => false,
    isCanUseVision: vi.fn().mockReturnValue(canUseVision),
    model: 'gpt-4',
    provider: 'openai',
  });

describe('MessageContentProcessor — v2 injection marker passthrough', () => {
  it('keeps isInjection/sourceKey/parentId on the multimodal return', async () => {
    const injection = injectionRow();
    const realUser = {
      content: 'real user words',
      createdAt: Date.now(),
      id: 'u-1',
      role: 'user',
      updatedAt: Date.now(),
    } as UIChatMessage;

    const result = await createProcessor(true).process(createContext([injection, realUser]));
    const processed = result.messages[0];

    expect(Array.isArray(processed.content)).toBe(true);
    expect(Buffer.from((processed.content as any[])[0].text, 'utf8')).toEqual(
      Buffer.from(injectionContent, 'utf8'),
    );
    expect((processed.content as any[])[1].image_url.url).toBe(
      'https://files.example.com/diagram.png',
    );
    expect(processed.isInjection).toBe(true);
    expect(processed.sourceKey).toBe('agent-document-message');
    expect(processed.parentId).toBe('u-0');
    expect(result.messages[1].content).toBe('real user words');
  });

  it('keeps the markers when an image is downgraded on the plain-text return', async () => {
    const injection = injectionRow();

    const result = await createProcessor(false).process(createContext([injection]));
    const processed = result.messages[0];

    expect(processed.content).toBe(`${injectionContent}\n\n${VISION_DOWNGRADE_PLACEHOLDER}`);
    expect(processed.isInjection).toBe(true);
    expect(processed.sourceKey).toBe('agent-document-message');
    expect(processed.parentId).toBe('u-0');
  });

  it('keeps a plain-text injection row byte-identical when a video part is dropped', async () => {
    const injection = {
      ...injectionRow(),
      content: injectionContent,
      videoList: [{ url: 'https://files.example.com/clip.mp4' }],
    } as UIChatMessage;

    const result = await createProcessor(false).process(createContext([injection]));
    const processed = result.messages[0];

    expect(Buffer.from(String(processed.content), 'utf8')).toEqual(
      Buffer.from(injectionContent, 'utf8'),
    );
    expect(processed.isInjection).toBe(true);
    expect(processed.sourceKey).toBe('agent-document-message');
    expect(processed.parentId).toBe('u-0');
  });

  // Regression for LOBE-290: the earlier multimodal case feeds an array `content`
  // with no `imageList`, so it exits through the fast path (`{ ...message }`) and
  // never reaches the structured-return branch. Here `content` is a string plus
  // an `imageList` with vision enabled, forcing contentParts = [text, image] and
  // the structured return at the end of processUserMessage — the exact branch
  // that must copy isInjection/sourceKey/parentId explicitly.
  it('keeps bytes, image and all three markers on the structured return for string content + imageList', async () => {
    const structuredText = '结构化注入 {{topic_id}} 备忘录  🏷️ 中文 emoji 🎯';
    const imageUrl = 'https://files.example.com/structured-return.png';
    const injection = {
      ...injectionRow(),
      content: structuredText,
      imageList: [{ url: imageUrl }],
    } as UIChatMessage;
    const realUser = {
      content: 'real user words',
      createdAt: Date.now(),
      id: 'u-2',
      role: 'user',
      updatedAt: Date.now(),
    } as UIChatMessage;

    const result = await createProcessor(true).process(createContext([injection, realUser]));
    const processed = result.messages[0];

    // Structured return: content is a text part followed by an image part.
    expect(Array.isArray(processed.content)).toBe(true);
    const parts = processed.content as any[];
    expect(parts[0].type).toBe('text');
    // UTF-8 bytes must match the original non-ASCII string exactly.
    expect(Buffer.from(parts[0].text, 'utf8')).toEqual(Buffer.from(structuredText, 'utf8'));
    expect(parts[1].type).toBe('image_url');
    expect(parts[1].image_url.url).toBe(imageUrl);
    // The three markers must survive the explicit structured-return object.
    expect(processed.isInjection).toBe(true);
    expect(processed.sourceKey).toBe('agent-document-message');
    expect(processed.parentId).toBe('u-0');
    // Real user control still takes the normal conversion path.
    expect(result.messages[1].content).toBe('real user words');
    // The normal conversion path must not leak injection markers onto a real user.
    expect(result.messages[1].isInjection).toBeUndefined();
    expect(result.messages[1].sourceKey).toBeUndefined();
    expect(result.messages[1].parentId).toBeUndefined();
  });
});
