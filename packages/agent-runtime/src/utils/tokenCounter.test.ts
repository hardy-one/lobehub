import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MAX_CONTEXT,
  DEFAULT_THRESHOLD_RATIO,
  getCompressionThreshold,
  isSmartCompressionDisabled,
  resolveThresholdRatio,
  shouldCompress,
  SMART_DISABLE_MAX_CONTEXT,
  SMART_MIN_BUFFER_TOKENS,
  SMART_THRESHOLD_RATIO,
} from './tokenCounter';

// Test fixtures only set the fields shouldCompress / countContextTokens read.
const mkMsg = (partial: Partial<UIChatMessage> & { role: UIChatMessage['role'] }): UIChatMessage =>
  ({
    content: '',
    createdAt: Date.now(),
    id: 'msg',
    meta: {},
    updatedAt: Date.now(),
    ...partial,
  }) as UIChatMessage;

describe('tokenCounter', () => {
  describe('resolveThresholdRatio', () => {
    it('defaults to 0.5', () => {
      expect(resolveThresholdRatio()).toBe(DEFAULT_THRESHOLD_RATIO);
    });

    it('uses 0.7 when smartThreshold is on', () => {
      expect(resolveThresholdRatio({ smartThreshold: true })).toBe(SMART_THRESHOLD_RATIO);
    });

    it('honours an explicit thresholdRatio over smartThreshold', () => {
      expect(resolveThresholdRatio({ smartThreshold: true, thresholdRatio: 0.9 })).toBe(0.9);
    });
  });

  describe('getCompressionThreshold', () => {
    it('should use default max context and threshold ratio', () => {
      const threshold = getCompressionThreshold();
      expect(threshold).toBe(Math.floor(DEFAULT_MAX_CONTEXT * DEFAULT_THRESHOLD_RATIO));
      expect(threshold).toBe(64_000); // 128k * 0.5
    });

    it('should use custom maxWindowToken', () => {
      const threshold = getCompressionThreshold({ maxWindowToken: 200_000 });
      expect(threshold).toBe(100_000); // 200k * 0.5
    });

    it('should use custom thresholdRatio', () => {
      const threshold = getCompressionThreshold({ thresholdRatio: 0.5 });
      expect(threshold).toBe(64_000); // 128k * 0.5
    });

    it('should use both custom values', () => {
      const threshold = getCompressionThreshold({
        maxWindowToken: 100_000,
        thresholdRatio: 0.8,
      });
      expect(threshold).toBe(80_000); // 100k * 0.8
    });

    it('should floor the result', () => {
      const threshold = getCompressionThreshold({
        maxWindowToken: 100,
        thresholdRatio: 0.33,
      });
      expect(threshold).toBe(33); // floor(100 * 0.33) = 33
    });

    it('should use 70% ratio under smartThreshold', () => {
      const threshold = getCompressionThreshold({
        maxWindowToken: 200_000,
        smartThreshold: true,
      });
      expect(threshold).toBe(140_000); // 200k * 0.7; buffer (180k) does not bind
    });

    it('should cap threshold by min free buffer under smartThreshold', () => {
      // 64k * 0.7 = 44_800, but maxWithBuffer = 64k - 20k = 44_000
      const threshold = getCompressionThreshold({
        maxWindowToken: 64_000,
        smartThreshold: true,
      });
      expect(threshold).toBe(64_000 - SMART_MIN_BUFFER_TOKENS);
      expect(threshold).toBe(44_000);
    });
  });

  describe('isSmartCompressionDisabled', () => {
    it('is false when smartThreshold is off', () => {
      expect(isSmartCompressionDisabled({ maxWindowToken: 16_000 })).toBe(false);
    });

    it('is true at or below 32k with smartThreshold', () => {
      expect(
        isSmartCompressionDisabled({
          maxWindowToken: SMART_DISABLE_MAX_CONTEXT,
          smartThreshold: true,
        }),
      ).toBe(true);
      expect(isSmartCompressionDisabled({ maxWindowToken: 16_000, smartThreshold: true })).toBe(
        true,
      );
    });

    it('is false above 32k with smartThreshold', () => {
      expect(isSmartCompressionDisabled({ maxWindowToken: 32_001, smartThreshold: true })).toBe(
        false,
      );
    });
  });

  describe('shouldCompress', () => {
    it('should return needsCompression=false when under threshold', () => {
      const result = shouldCompress([mkMsg({ role: 'user', content: 'Hi' })]);

      expect(result.needsCompression).toBe(false);
      expect(result.currentTokenCount).toBeGreaterThan(0);
      expect(result.threshold).toBe(64_000); // 128k * 0.5
    });

    it('should return needsCompression=true when over threshold', () => {
      const result = shouldCompress([
        mkMsg({
          role: 'assistant',
          metadata: { usage: { totalOutputTokens: 70_000 } as any } as any,
        }),
      ]);

      expect(result.needsCompression).toBe(true);
      expect(result.currentTokenCount).toBe(70_000);
      expect(result.threshold).toBe(64_000); // 128k * 0.5
    });

    it('should return needsCompression=true when raw count is at threshold (drift pushes over)', () => {
      // 1.25× default drift multiplier means raw==threshold → adjusted > threshold
      // → compression fires. This is intentional: we want to compress before the
      // upstream tokenizer overflows the model's context window.
      const result = shouldCompress([
        mkMsg({
          role: 'assistant',
          metadata: { usage: { totalOutputTokens: 64_000 } as any } as any,
        }),
      ]);

      expect(result.needsCompression).toBe(true);
      expect(result.currentTokenCount).toBe(64_000);
    });

    it('should NOT trigger at threshold when driftMultiplier is 1', () => {
      // Disabling drift restores strict "raw > threshold" semantics
      const result = shouldCompress(
        [
          mkMsg({
            role: 'assistant',
            metadata: { usage: { totalOutputTokens: 64_000 } as any } as any,
          }),
        ],
        { driftMultiplier: 1 },
      );

      expect(result.needsCompression).toBe(false);
      expect(result.currentTokenCount).toBe(64_000);
    });

    it('should use custom options', () => {
      const result = shouldCompress(
        [
          mkMsg({
            role: 'assistant',
            metadata: { usage: { totalOutputTokens: 50_000 } as any } as any,
          }),
        ],
        {
          maxWindowToken: 60_000,
          thresholdRatio: 0.75,
        },
      );

      // threshold = 60k * 0.75 = 45k, current = 50k > 45k
      expect(result.needsCompression).toBe(true);
      expect(result.threshold).toBe(45_000);
    });

    it('should handle empty messages', () => {
      const result = shouldCompress([]);

      expect(result.needsCompression).toBe(false);
      expect(result.currentTokenCount).toBe(0);
    });

    // Bug B: tool definitions also occupy the input window, so a
    // message payload that fits when tools are absent can overflow once tool
    // definitions are accounted for. Without this, compression only fires on
    // message size and leaves the tool budget to silently push the request
    // past the model's context window (openrouter "ExceededContextWindow").
    it('should count tool definition tokens against the budget', () => {
      const messages = [
        mkMsg({
          role: 'assistant',
          metadata: { usage: { totalOutputTokens: 50_000 } as any } as any,
        }),
      ];
      const options = { driftMultiplier: 1, maxWindowToken: 100_000, thresholdRatio: 0.6 };

      const withoutTools = shouldCompress(messages, options);
      expect(withoutTools.needsCompression).toBe(false);

      // A chunky tool manifest (~20K tokens of JSON) should push us over.
      const bigTool = {
        function: {
          description: 'x'.repeat(80_000),
          name: 'big_tool',
          parameters: { properties: {}, type: 'object' },
        },
        type: 'function',
      };
      const withTools = shouldCompress(messages, { ...options, tools: [bigTool] });

      expect(withTools.needsCompression).toBe(true);
      expect(withTools.currentTokenCount).toBeGreaterThan(withoutTools.currentTokenCount);
    });

    it('should not compress ≤32k models under smartThreshold even when over 50% usage', () => {
      const result = shouldCompress(
        [
          mkMsg({
            role: 'assistant',
            metadata: { usage: { totalOutputTokens: 30_000 } as any } as any,
          }),
        ],
        {
          driftMultiplier: 1,
          maxWindowToken: 32_000,
          smartThreshold: true,
        },
      );

      expect(result.needsCompression).toBe(false);
      expect(result.threshold).toBe(32_000);
      expect(result.currentTokenCount).toBe(30_000);
    });

    it('should use smart 70% threshold for large windows', () => {
      // 200k * 0.7 = 140k; 130k raw with drift=1 stays under
      const under = shouldCompress(
        [
          mkMsg({
            role: 'assistant',
            metadata: { usage: { totalOutputTokens: 130_000 } as any } as any,
          }),
        ],
        {
          driftMultiplier: 1,
          maxWindowToken: 200_000,
          smartThreshold: true,
        },
      );
      expect(under.needsCompression).toBe(false);
      expect(under.threshold).toBe(140_000);

      const over = shouldCompress(
        [
          mkMsg({
            role: 'assistant',
            metadata: { usage: { totalOutputTokens: 140_001 } as any } as any,
          }),
        ],
        {
          driftMultiplier: 1,
          maxWindowToken: 200_000,
          smartThreshold: true,
        },
      );
      expect(over.needsCompression).toBe(true);
      expect(over.threshold).toBe(140_000);
    });
  });
});
