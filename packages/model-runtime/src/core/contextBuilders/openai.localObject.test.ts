import type OpenAI from 'openai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseDataUri } from '../../utils/uriParser';
import { convertMessageContent } from './openai';

vi.mock('@lobechat/utils', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();

  return {
    ...actual,
    imageUrlToBase64: vi.fn(),
    videoUrlToBase64: vi.fn(),
  };
});

vi.mock('../../utils/uriParser', () => ({
  parseDataUri: vi.fn(),
}));

const imageContent = {
  type: 'image_url',
  image_url: { url: 'https://s3.example.com/lobe/files/1.png' },
} as OpenAI.ChatCompletionContentPart;

describe('convertMessageContent with a local object reader', () => {
  let imageUrlToBase64: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    imageUrlToBase64 = (await import('@lobechat/utils')).imageUrlToBase64 as ReturnType<
      typeof vi.fn
    >;
    process.env.LLM_VISION_IMAGE_USE_BASE64 = '1';
    vi.mocked(parseDataUri).mockReturnValue({ base64: null, mimeType: null, type: 'url' });
    imageUrlToBase64.mockResolvedValue({ base64: 'downloaded', mimeType: 'image/png' });
  });

  afterEach(() => {
    process.env.LLM_VISION_IMAGE_USE_BASE64 = undefined;
    vi.clearAllMocks();
  });

  it('reads owned objects from storage instead of downloading them', async () => {
    const localObjectReader = vi
      .fn()
      .mockResolvedValue({ base64: 'fromStorage', mimeType: 'image/png' });

    const result = await convertMessageContent(imageContent, {
      forceImageBase64: true,
      localObjectReader,
    });

    expect(localObjectReader).toHaveBeenCalledWith('https://s3.example.com/lobe/files/1.png');
    expect(imageUrlToBase64).not.toHaveBeenCalled();
    expect(result).toEqual({
      image_url: { url: 'data:image/png;base64,fromStorage' },
      type: 'image_url',
    });
  });

  it('downloads external URLs the storage layer does not own', async () => {
    const localObjectReader = vi.fn().mockResolvedValue(undefined);

    const result = await convertMessageContent(imageContent, {
      forceImageBase64: true,
      localObjectReader,
    });

    expect(imageUrlToBase64).toHaveBeenCalledWith('https://s3.example.com/lobe/files/1.png');
    expect(result).toEqual({
      image_url: { url: 'data:image/png;base64,downloaded' },
      type: 'image_url',
    });
  });

  it('falls back to download when the storage read fails', async () => {
    const localObjectReader = vi.fn().mockRejectedValue(new Error('NoSuchKey'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await convertMessageContent(imageContent, {
      forceImageBase64: true,
      localObjectReader,
    });

    expect(imageUrlToBase64).toHaveBeenCalledWith('https://s3.example.com/lobe/files/1.png');
    expect(result).toEqual({
      image_url: { url: 'data:image/png;base64,downloaded' },
      type: 'image_url',
    });
    warn.mockRestore();
  });

  it('keeps the download path when no reader is provided', async () => {
    await convertMessageContent(imageContent, { forceImageBase64: true });

    expect(imageUrlToBase64).toHaveBeenCalledWith('https://s3.example.com/lobe/files/1.png');
  });
});
