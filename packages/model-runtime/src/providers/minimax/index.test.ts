// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { describe, expect, it } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeMinimaxAI, params } from './index';

const provider = ModelProvider.Minimax;
const defaultBaseURL = 'https://api.minimaxi.com/v1';

testProvider({
  Runtime: LobeMinimaxAI,
  provider,
  defaultBaseURL,
  chatDebugEnv: 'DEBUG_MINIMAX_CHAT_COMPLETION',
  chatModel: 'abab6.5s-chat',
  test: {
    skipAPICall: true,
  },
});

describe('LobeMinimaxAI - custom features', () => {
  describe('chatCompletion.handlePayload', () => {
    it('should ensure function.arguments is a string when tool_calls present', () => {
      const payload = {
        messages: [
          { role: 'user', content: 'What is the weather?' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_123',
                type: 'function',
                function: {
                  name: 'get_weather',
                  arguments: { location: 'Beijing' }, // Object instead of string
                },
              },
            ],
          },
        ],
        model: 'abab6.5s-chat',
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result.messages[1].tool_calls[0].function.arguments).toBe('{"location":"Beijing"}');
    });

    it('should preserve function.arguments when already a string', () => {
      const payload = {
        messages: [
          { role: 'user', content: 'What is the weather?' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_123',
                type: 'function',
                function: {
                  name: 'get_weather',
                  arguments: '{"location":"Beijing"}', // Already a string
                },
              },
            ],
          },
        ],
        model: 'abab6.5s-chat',
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result.messages[1].tool_calls[0].function.arguments).toBe('{"location":"Beijing"}');
    });

    it('should handle empty arguments object', () => {
      const payload = {
        messages: [
          { role: 'user', content: 'Hello' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_456',
                type: 'function',
                function: {
                  name: 'some_function',
                  arguments: {}, // Empty object
                },
              },
            ],
          },
        ],
        model: 'abab6.5s-chat',
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result.messages[1].tool_calls[0].function.arguments).toBe('{}');
    });

    it('should handle undefined arguments', () => {
      const payload = {
        messages: [
          { role: 'user', content: 'Hello' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_789',
                type: 'function',
                function: {
                  name: 'another_function',
                  // arguments field is missing
                },
              },
            ],
          },
        ],
        model: 'abab6.5s-chat',
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result.messages[1].tool_calls[0].function.arguments).toBe('{}');
    });
  });
});
