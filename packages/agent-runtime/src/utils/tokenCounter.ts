import { countContextTokens, DEFAULT_DRIFT_MULTIPLIER } from '@lobechat/context-engine';
import type { UIChatMessage } from '@lobechat/types';

/**
 * Options for token counting and compression threshold calculation
 */
export interface TokenCountOptions {
  /**
   * Optional drift multiplier override forwarded to {@link countContextTokens}.
   * Default {@link DEFAULT_DRIFT_MULTIPLIER} (1.25).
   */
  driftMultiplier?: number;
  /** Model's max context window token count */
  maxWindowToken?: number;
  /**
   * Enable smart threshold strategy:
   * - Uses 70% threshold ratio (instead of default 50%) when `thresholdRatio` is unset
   * - Applies 20k minimum free-buffer protection for small context models
   * - Disables compression for models with ≤32k context
   */
  smartThreshold?: boolean;
  /**
   * Id of the last message covered by `storedContextTokens` — the anchor for
   * the incremental estimate. Must exist in `messages` for the baseline path;
   * otherwise the whole set is estimated (fallback).
   */
  storedContextLastMsgId?: string;

  /**
   * Stored real context tokens from the previous completed request
   * (`usage.totalTokens` = input + output; the output is already part of the
   * history being sent this turn). When provided together with a matching
   * `storedContextLastMsgId`, the compression estimate becomes:
   *
   *     current = storedContextTokens + estimate(messages after the anchor)
   *
   * so the (large) history portion carries zero estimation error and only the
   * delta since the last request is estimated. Falls back to full estimation
   * when the anchor message is no longer present (compressed / deleted) or the
   * value is absent (first turn).
   */
  storedContextTokens?: number;

  /** Threshold ratio for triggering compression, default 0.5 (or 0.7 when smartThreshold is on) */
  thresholdRatio?: number;

  /**
   * Optional top-level tool definitions for the upcoming LLM call. When
   * provided, tool definition tokens are counted toward the budget — matches
   * what the provider actually charges. Pass the same `tools` array that will
   * be sent in the request payload.
   */
  tools?: unknown[];
}

/** Default max context window (128k tokens) */
export const DEFAULT_MAX_CONTEXT = 128_000;

/** Default threshold ratio (50% of max context) */
export const DEFAULT_THRESHOLD_RATIO = 0.5;

/** Smart mode threshold ratio (70% of max context) */
export const SMART_THRESHOLD_RATIO = 0.7;

/**
 * Smart mode keeps at least this many tokens free for model output / overhead
 * by capping the compression threshold at `maxWindowToken - buffer`.
 */
export const SMART_MIN_BUFFER_TOKENS = 20_000;

/**
 * Models with a context window at or below this size skip compression entirely
 * under smart threshold mode (summarization cost outweighs benefit).
 */
export const SMART_DISABLE_MAX_CONTEXT = 32_000;

/**
 * Resolve the effective threshold ratio, honouring an explicit override first.
 */
function resolveThresholdRatio(options: TokenCountOptions = {}): number {
  if (typeof options.thresholdRatio === 'number') return options.thresholdRatio;
  return options.smartThreshold ? SMART_THRESHOLD_RATIO : DEFAULT_THRESHOLD_RATIO;
}

/**
 * Calculate the compression threshold based on max context window
 */
export function getCompressionThreshold(options: TokenCountOptions = {}): number {
  const maxContext = options.maxWindowToken ?? DEFAULT_MAX_CONTEXT;
  const ratio = resolveThresholdRatio(options);
  let threshold = Math.floor(maxContext * ratio);

  if (options.smartThreshold) {
    // Leave a free buffer for completion tokens / tokenizer drift on smaller windows.
    const maxWithBuffer = Math.max(0, maxContext - SMART_MIN_BUFFER_TOKENS);
    threshold = Math.min(threshold, maxWithBuffer);
  }

  return threshold;
}

/**
 * Whether smart mode should skip compression for this context window size.
 */
function isSmartCompressionDisabled(options: TokenCountOptions = {}): boolean {
  if (!options.smartThreshold) return false;
  const maxContext = options.maxWindowToken ?? DEFAULT_MAX_CONTEXT;
  return maxContext <= SMART_DISABLE_MAX_CONTEXT;
}

/**
 * Result of compression check
 */
export interface CompressionCheckResult {
  /**
   * Best raw estimate of current input tokens (sum of message content +
   * tool calls + reasoning + tool_call_id + tool definitions).
   */
  currentTokenCount: number;
  /**
   * `true` when `adjustedTokenCount > threshold`. The adjusted count includes
   * a drift multiplier (default 1.25×) to compensate for the gap between
   * `tokenx`'s heuristic and provider tokenizers, so compression fires before
   * upstream tokenizers actually overflow the model's context window.
   */
  needsCompression: boolean;
  /** Compression threshold (`maxWindowToken × thresholdRatio`, with smart caps) */
  threshold: number;
}

/**
 * Check if messages need compression based on token count.
 *
 * Uses {@link countContextTokens} under the hood, so the input estimate
 * accounts for tool calls, reasoning, and tool definitions in addition to
 * `content` (see for the calibration data).
 */
export function shouldCompress(
  messages: UIChatMessage[],
  options: TokenCountOptions = {},
): CompressionCheckResult {
  const drift = options.driftMultiplier ?? DEFAULT_DRIFT_MULTIPLIER;

  // Baseline path: a stored real-token value plus a live anchor message in the
  // set. The anchor must still exist — after compression/deletion the stored
  // value no longer corresponds to the visible history, so fall back.
  const { storedContextLastMsgId, storedContextTokens } = options;
  // The caller (application layer) is responsible for baseline freshness:
  // it must clear/omit `storedContextTokens` when the model/provider changed
  // since the value was measured (a different tokenizer would make the stored
  // count incomparable). Here we only require a positive value + a live anchor.
  const anchorIndex =
    typeof storedContextTokens === 'number' &&
    storedContextTokens > 0 &&
    typeof storedContextLastMsgId === 'string'
      ? messages.findIndex((m) => m.id === storedContextLastMsgId)
      : -1;
  const useBaseline = anchorIndex >= 0;

  // Tools definitions: in baseline mode the stored value already includes the
  // previous request's tool schemas (the provider tokenized them), so counting
  // them again on the delta would double-count. Fallback counts them (legacy).
  const baselineDeltaRaw = useBaseline
    ? countContextTokens({
        messages: messages.slice(anchorIndex + 1),
        options: { driftMultiplier: 1 },
      }).rawTotal
    : 0;

  // Emit one structured line per check so the detection path is fully
  // traceable: whether the real provider-measured usage (apiTokens) is used as
  // a baseline or the whole set is estimated, the estimated portion, the
  // drift-adjusted total, and the threshold the decision is made against.

  if (isSmartCompressionDisabled(options)) {
    const currentTokenCount = useBaseline
      ? storedContextTokens! + baselineDeltaRaw
      : countContextTokens({
          messages,
          options: { driftMultiplier: 1 },
          tools: options.tools,
        }).rawTotal;

    const result: CompressionCheckResult = {
      currentTokenCount,
      needsCompression: false,
      // Surface the full window as the "threshold" so callers/logs don't treat
      // the disabled path as "already over budget".
      threshold: options.maxWindowToken ?? DEFAULT_MAX_CONTEXT,
    };
    return result;
  }

  const threshold = getCompressionThreshold(options);

  if (useBaseline) {
    // Real baseline + estimated delta. Drift applies to the delta only — the
    // baseline is the provider's own tokenization and needs no headroom.
    const currentTokenCount = storedContextTokens! + baselineDeltaRaw;
    const adjustedTotal = storedContextTokens! + Math.ceil(baselineDeltaRaw * drift);

    const result: CompressionCheckResult = {
      currentTokenCount,
      needsCompression: adjustedTotal > threshold,
      threshold,
    };
    return result;
  }

  // Fallback: estimate the whole set (legacy behaviour, drift on everything).
  const accounting = countContextTokens({
    messages,
    options: { driftMultiplier: drift },
    tools: options.tools,
  });
  const result: CompressionCheckResult = {
    currentTokenCount: accounting.rawTotal,
    needsCompression: accounting.adjustedTotal > threshold,
    threshold,
  };
  return result;
}
