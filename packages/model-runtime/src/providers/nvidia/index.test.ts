// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeNvidiaAI, params } from './index';

const provider = ModelProvider.Nvidia;
const defaultBaseURL = 'https://integrate.api.nvidia.com/v1';

testProvider({
  Runtime: LobeNvidiaAI,
  provider,
  defaultBaseURL,
  chatDebugEnv: 'DEBUG_NVIDIA_CHAT_COMPLETION',
  chatModel: 'meta/llama-3.1-8b-instruct',
  test: {
    skipAPICall: true,
  },
});

describe('LobeNvidiaAI - custom features', () => {
  describe('handlePayload', () => {
    it('should add chat_template_kwargs with thinking enabled for thinking models', () => {
      const payload = {
        model: 'deepseek-ai/deepseek-v3.1',
        messages: [{ role: 'user', content: 'test' }],
        thinking: { type: 'enabled' as const },
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result).toEqual({
        model: 'deepseek-ai/deepseek-v3.1',
        messages: [{ role: 'user', content: 'test' }],
        chat_template_kwargs: { thinking: true },
      });
    });

    it('should add chat_template_kwargs with thinking disabled for thinking models', () => {
      const payload = {
        model: 'deepseek-ai/deepseek-v3.1-terminus',
        messages: [{ role: 'user', content: 'test' }],
        thinking: { type: 'disabled' as const },
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result).toEqual({
        model: 'deepseek-ai/deepseek-v3.1-terminus',
        messages: [{ role: 'user', content: 'test' }],
        chat_template_kwargs: { thinking: false },
      });
    });

    it('should add chat_template_kwargs with thinking undefined for thinking models without thinking type', () => {
      const payload = {
        model: 'deepseek-ai/deepseek-v3.1',
        messages: [{ role: 'user', content: 'test' }],
        thinking: {},
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result).toEqual({
        model: 'deepseek-ai/deepseek-v3.1',
        messages: [{ role: 'user', content: 'test' }],
        chat_template_kwargs: { thinking: undefined },
      });
    });

    it('should not add chat_template_kwargs for non-thinking models', () => {
      const payload = {
        model: 'meta/llama-3.1-8b-instruct',
        messages: [{ role: 'user', content: 'test' }],
        thinking: { type: 'enabled' as const },
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result).toEqual({
        model: 'meta/llama-3.1-8b-instruct',
        messages: [{ role: 'user', content: 'test' }],
      });
    });

    it('should handle payload without thinking parameter', () => {
      const payload = {
        model: 'deepseek-ai/deepseek-v3.1',
        messages: [{ role: 'user', content: 'test' }],
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result).toEqual({
        model: 'deepseek-ai/deepseek-v3.1',
        messages: [{ role: 'user', content: 'test' }],
        chat_template_kwargs: { thinking: undefined },
      });
    });

    it('should preserve other payload properties', () => {
      const payload = {
        model: 'deepseek-ai/deepseek-v3.1',
        messages: [{ role: 'user', content: 'test' }],
        thinking: { type: 'enabled' as const },
        temperature: 0.7,
        max_tokens: 1000,
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result).toEqual({
        model: 'deepseek-ai/deepseek-v3.1',
        messages: [{ role: 'user', content: 'test' }],
        temperature: 0.7,
        max_tokens: 1000,
        chat_template_kwargs: { thinking: true },
      });
    });

    it('should add chat_template_kwargs for deepseek-v3.2', () => {
      const payload = {
        model: 'deepseek-ai/deepseek-v3.2',
        messages: [{ role: 'user', content: 'test' }],
        thinking: { type: 'enabled' as const },
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result).toEqual({
        model: 'deepseek-ai/deepseek-v3.2',
        messages: [{ role: 'user', content: 'test' }],
        chat_template_kwargs: { thinking: true },
      });
    });

    it('should add chat_template_kwargs for glm-4.7', () => {
      const payload = {
        model: 'z-ai/glm4.7',
        messages: [{ role: 'user', content: 'test' }],
        thinking: { type: 'enabled' as const },
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result).toEqual({
        model: 'z-ai/glm4.7',
        messages: [{ role: 'user', content: 'test' }],
        chat_template_kwargs: { thinking: true },
      });
    });

    it('should add chat_template_kwargs for kimi-k2.5', () => {
      const payload = {
        model: 'moonshotai/kimi-k2.5',
        messages: [{ role: 'user', content: 'test' }],
        thinking: { type: 'enabled' as const },
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result).toEqual({
        model: 'moonshotai/kimi-k2.5',
        messages: [{ role: 'user', content: 'test' }],
        chat_template_kwargs: { thinking: true },
      });
    });

    it('should not add chat_template_kwargs for minimax-m2.1', () => {
      const payload = {
        model: 'minimaxai/minimax-m2.1',
        messages: [{ role: 'user', content: 'test' }],
        thinking: { type: 'enabled' as const },
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result).toEqual({
        model: 'minimaxai/minimax-m2.1',
        messages: [{ role: 'user', content: 'test' }],
      });
    });

    it('should convert reasoning to reasoning_content for assistant messages', () => {
      const payload = {
        model: 'deepseek-ai/deepseek-v3.2',
        messages: [
          { role: 'user', content: 'test' },
          { role: 'assistant', reasoning: { content: 'thinking process' }, content: 'response' },
        ],
        thinking: { type: 'enabled' as const },
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result.messages).toEqual([
        { role: 'user', content: 'test' },
        { role: 'assistant', content: 'response', reasoning_content: 'thinking process' },
      ]);
    });

    it('should not modify messages without reasoning', () => {
      const payload = {
        model: 'deepseek-ai/deepseek-v3.2',
        messages: [
          { role: 'user', content: 'test' },
          { role: 'assistant', content: 'response' },
        ],
        thinking: { type: 'enabled' as const },
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result.messages).toEqual([
        { role: 'user', content: 'test' },
        { role: 'assistant', content: 'response' },
      ]);
    });
  });

  describe('models', () => {
    it('should fetch and process models successfully', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              { id: 'meta/llama-3.1-8b-instruct' },
              { id: 'deepseek-ai/deepseek-v3.1' },
              { id: 'nvidia/nemotron-4-340b-instruct' },
            ],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });

      expect(mockClient.models.list).toHaveBeenCalled();
      expect(models).toBeDefined();
      expect(Array.isArray(models)).toBe(true);
    });

    it('should handle empty model list', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });

      expect(mockClient.models.list).toHaveBeenCalled();
      expect(models).toBeDefined();
      expect(Array.isArray(models)).toBe(true);
    });

    it('should handle API errors gracefully', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockRejectedValue(new Error('API Error')),
        },
      };

      await expect(params.models!({ client: mockClient as any })).rejects.toThrow('API Error');
      expect(mockClient.models.list).toHaveBeenCalled();
    });
  });

  describe('debug configuration', () => {
    it('should enable debug when env is set', () => {
      process.env.DEBUG_NVIDIA_CHAT_COMPLETION = '1';
      const result = params.debug.chatCompletion();
      expect(result).toBe(true);
      delete process.env.DEBUG_NVIDIA_CHAT_COMPLETION;
    });

    it('should disable debug by default', () => {
      delete process.env.DEBUG_NVIDIA_CHAT_COMPLETION;
      const result = params.debug.chatCompletion();
      expect(result).toBe(false);
    });
  });
});
