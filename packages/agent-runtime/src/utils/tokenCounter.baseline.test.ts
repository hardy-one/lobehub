import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { shouldCompress } from './tokenCounter';

// Fixtures only set the fields shouldCompress / countContextTokens read.
const mkMsg = (partial: Partial<UIChatMessage> & { role: UIChatMessage['role'] }): UIChatMessage =>
  ({
    content: '',
    createdAt: Date.now(),
    id: 'msg',
    meta: {},
    updatedAt: Date.now(),
    ...partial,
  }) as UIChatMessage;

/**
 * 压缩基线模式（存储的真实上下文 + 增量估算）边界情况。
 *
 * 语义：
 *   - storedContextTokens: 上次请求结束时存储的真实上下文 tokens
 *     （usage.totalTokens = 输入 + 输出，输出即本次历史）
 *   - storedContextLastMsgId: 基线对应的最后消息 id（锚点）
 *   - 压缩时：current = storedContextTokens + 估算(锚点之后的新消息)
 *   - fallback：无存储基线或锚点失效 → 全量估算（现状行为）
 */
describe('shouldCompress with stored baseline', () => {
  // 1. fallback：无存储基线 → 全量估算（首次对话/从未存储）
  it('falls back to full estimation when no stored baseline exists', () => {
    const result = shouldCompress([mkMsg({ role: 'user', content: 'Hi' })]);

    expect(result.needsCompression).toBe(false);
    expect(result.currentTokenCount).toBeGreaterThan(0);
    expect(result.threshold).toBe(64_000);
  });

  // 2. fallback：storedContextTokens 为 0 / undefined → 全量估算
  it('falls back when storedContextTokens is 0 or undefined', () => {
    const msg = mkMsg({ role: 'user', content: 'Hello world' });
    const zero = shouldCompress([msg], {
      storedContextLastMsgId: msg.id,
      storedContextTokens: 0,
    });
    const missing = shouldCompress([msg], { storedContextLastMsgId: msg.id });

    expect(zero.currentTokenCount).toBe(missing.currentTokenCount);
    expect(zero.currentTokenCount).toBeLessThan(10_000);
  });

  // 3. 锚点存在 + 无新增消息 → current = 存储基线（真实值直接采用）
  it('uses stored baseline as-is when anchor is the last message', () => {
    const anchor = mkMsg({ id: 'anchor', role: 'assistant', content: 'x' });
    const result = shouldCompress([anchor], {
      storedContextLastMsgId: 'anchor',
      storedContextTokens: 50_000,
    });

    expect(result.currentTokenCount).toBe(50_000);
  });

  // 4. 锚点存在 + 有新增消息 → current = 基线 + 增量估算
  it('adds estimated delta for messages after the anchor', () => {
    const anchor = mkMsg({ id: 'anchor', role: 'assistant', content: 'x' });
    const newMsg = mkMsg({ id: 'new-1', role: 'user', content: 'y'.repeat(2000) });

    const result = shouldCompress([anchor, newMsg], {
      storedContextLastMsgId: 'anchor',
      storedContextTokens: 50_000,
    });

    // 增量 = 新消息单独估算（drift=1 取 raw）
    const deltaOnly = shouldCompress([newMsg], { driftMultiplier: 1 }).currentTokenCount;
    expect(result.currentTokenCount).toBe(50_000 + deltaOnly);
    expect(deltaOnly).toBeGreaterThan(0);
  });

  // 5. 锚点失效（消息被删/压缩后）→ fallback 全量估算（不含基线）
  it('falls back to full estimation when anchor message is missing', () => {
    const msg = mkMsg({ id: 'other', role: 'user', content: 'Hello' });
    const result = shouldCompress([msg], {
      storedContextLastMsgId: 'anchor-not-found',
      storedContextTokens: 50_000,
    });

    // fallback：不含 50k 基线
    expect(result.currentTokenCount).toBeLessThan(50_000);
  });

  // 6. 基线单独超过阈值 → 压缩触发（即使无新增消息）
  it('triggers compression when stored baseline alone exceeds threshold', () => {
    const anchor = mkMsg({ id: 'anchor', role: 'assistant', content: 'x' });
    const result = shouldCompress([anchor], {
      storedContextLastMsgId: 'anchor',
      storedContextTokens: 70_000, // > 64k 默认阈值
    });

    expect(result.needsCompression).toBe(true);
    expect(result.currentTokenCount).toBe(70_000);
  });

  // 7. 基线 + 增量超过阈值 → 压缩触发
  it('triggers compression when baseline + delta exceeds threshold', () => {
    const anchor = mkMsg({ id: 'anchor', role: 'assistant', content: 'x' });
    const big = mkMsg({ id: 'new', role: 'user', content: 'y'.repeat(80_000) });

    const result = shouldCompress([anchor, big], {
      storedContextLastMsgId: 'anchor',
      storedContextTokens: 60_000, // 64k 阈值内，但增量会推过
    });

    expect(result.needsCompression).toBe(true);
    expect(result.currentTokenCount).toBeGreaterThan(64_000);
  });

  // 8. 基线 + 小增量未超阈值 → 不压缩
  it('does not compress when baseline + small delta stays under threshold', () => {
    const anchor = mkMsg({ id: 'anchor', role: 'assistant', content: 'x' });
    const small = mkMsg({ id: 'new', role: 'user', content: 'hi' });

    const result = shouldCompress([anchor, small], {
      storedContextLastMsgId: 'anchor',
      storedContextTokens: 60_000,
    });

    expect(result.needsCompression).toBe(false);
  });

  // 9. drift 只作用于增量部分：基线真实值不受 drift 放大
  it('applies drift to delta only, never to the stored baseline', () => {
    const anchor = mkMsg({ id: 'anchor', role: 'assistant', content: 'x' });
    const newMsg = mkMsg({ id: 'new', role: 'user', content: 'y'.repeat(2000) });
    const base = { storedContextLastMsgId: 'anchor', storedContextTokens: 50_000 };

    const drift1 = shouldCompress([anchor, newMsg], { ...base, driftMultiplier: 1 });
    const drift5 = shouldCompress([anchor, newMsg], { ...base, driftMultiplier: 5 });

    // currentTokenCount = 基线 + 增量 raw（不含 drift）→ 与 drift 无关
    expect(drift1.currentTokenCount).toBe(drift5.currentTokenCount);
    // 判断用 adjusted（增量 × drift）→ drift 越大越可能触发
    expect(drift5.needsCompression).toBe(drift1.needsCompression);
  });

  // 10. smartThreshold 禁用路径（≤32k 模型）在基线模式下同样遵循
  it('respects smartThreshold disable with baseline present', () => {
    const anchor = mkMsg({ id: 'anchor', role: 'assistant', content: 'x' });
    const result = shouldCompress([anchor], {
      maxWindowToken: 32_000,
      smartThreshold: true,
      storedContextLastMsgId: 'anchor',
      storedContextTokens: 30_000,
    });

    expect(result.needsCompression).toBe(false);
    expect(result.threshold).toBe(32_000);
  });

  // 11. 空消息 + 基线（锚点必然不存在）→ fallback → 0
  it('handles empty messages with a stale baseline', () => {
    const result = shouldCompress([], {
      storedContextLastMsgId: 'anchor',
      storedContextTokens: 50_000,
    });

    expect(result.currentTokenCount).toBe(0);
    expect(result.needsCompression).toBe(false);
  });

  // 12. 基线模式增量不含工具定义（基线 usage 已含上次工具定义，避免重复计数）
  it('does not double-count tool definitions in baseline mode', () => {
    const anchor = mkMsg({ id: 'anchor', role: 'assistant', content: 'x' });
    const newMsg = mkMsg({ id: 'new', role: 'user', content: 'hi' });
    const bigTool = {
      function: {
        description: 'x'.repeat(80_000),
        name: 'big_tool',
        parameters: { properties: {}, type: 'object' },
      },
      type: 'function',
    };
    const base = { storedContextLastMsgId: 'anchor', storedContextTokens: 50_000 };

    const withoutTools = shouldCompress([anchor, newMsg], base);
    const withTools = shouldCompress([anchor, newMsg], { ...base, tools: [bigTool] });

    // 基线模式下 tools 不重复计入 → 结果一致
    expect(withTools.currentTokenCount).toBe(withoutTools.currentTokenCount);
  });

  // 13. fallback 模式工具定义照常计入（现状行为保留）
  it('still counts tool definitions in fallback (no baseline) mode', () => {
    const msg = mkMsg({
      role: 'assistant',
      metadata: { usage: { totalOutputTokens: 50_000 } as any } as any,
    });
    const bigTool = {
      function: {
        description: 'x'.repeat(80_000),
        name: 'big_tool',
        parameters: { properties: {}, type: 'object' },
      },
      type: 'function',
    };
    const options = { driftMultiplier: 1, maxWindowToken: 100_000, thresholdRatio: 0.6 };

    const withoutTools = shouldCompress([msg], options);
    const withTools = shouldCompress([msg], { ...options, tools: [bigTool] });

    expect(withoutTools.needsCompression).toBe(false);
    expect(withTools.needsCompression).toBe(true);
    expect(withTools.currentTokenCount).toBeGreaterThan(withoutTools.currentTokenCount);
  });
});
