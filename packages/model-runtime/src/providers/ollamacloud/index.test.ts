// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LobeOllamaCloudAI } from './index';

describe('LobeOllamaCloudAI', () => {
  let instance: LobeOllamaCloudAI;

  beforeEach(() => {
    vi.clearAllMocks();
    instance = new LobeOllamaCloudAI({ apiKey: 'test_api_key' });
  });

  describe('init', () => {
    it('should correctly initialize with an API key', () => {
      expect(instance).toBeInstanceOf(LobeOllamaCloudAI);
    });

    it('should initialize without an API key (auth optional for Ollama SDK)', () => {
      const instance = new LobeOllamaCloudAI({});
      expect(instance).toBeInstanceOf(LobeOllamaCloudAI);
    });
  });
});
