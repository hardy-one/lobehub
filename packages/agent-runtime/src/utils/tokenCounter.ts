import { DEFAULT_DRIFT_MULTIPLIER, planAttachmentPreviews } from '@lobechat/context-engine';
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
   * Raw (undrifted) input tokens already spent outside `messages` — the
   * preamble the context engine assembles (system role, knowledge, memory,
   * skills) plus the tool schemas. When supplied, attachment previews are
   * planned against the room these leave under the threshold, and the reported
   * totals include them.
   */
  overheadTokens?: number;
  /** Threshold ratio for triggering compression, default 0.75 */
  thresholdRatio?: number;
  /**
   * Optional top-level tool definitions for the upcoming LLM call. When
   * provided, tool definition tokens are counted toward the budget — matches
   * what the provider actually charges. Pass the same `tools` array that will
   * be sent in the request payload. Ignored when `overheadTokens` already
   * accounts for them.
   */
  tools?: unknown[];
}

/** Default max context window (128k tokens) */
export const DEFAULT_MAX_CONTEXT = 128_000;

/**
 * Default threshold ratio (75% of max context). The remaining quarter of the
 * window is reserved for the completion and any preamble not named in
 * `overheadTokens`.
 */
export const DEFAULT_THRESHOLD_RATIO = 0.75;

/**
 * Calculate the compression threshold based on max context window
 */
export function getCompressionThreshold(options: TokenCountOptions = {}): number {
  const maxContext = options.maxWindowToken ?? DEFAULT_MAX_CONTEXT;
  const ratio = options.thresholdRatio ?? DEFAULT_THRESHOLD_RATIO;
  return Math.floor(maxContext * ratio);
}

/**
 * Result of compression check
 */
export interface CompressionCheckResult {
  /**
   * Attachments to send as a preview plus file id so attachment text stays
   * within the room the rest of the context leaves under the threshold. Pass
   * them to the context engine with the `call_llm` payload.
   */
  attachmentPreviewFileIds: string[];
  /** Raw estimate of the input tokens this request carries (context + overhead). */
  currentTokenCount: number;
  /**
   * `true` when the drift-adjusted total exceeds `threshold`. The adjustment
   * (default 1.25×) covers the gap between `tokenx`'s heuristic and provider
   * tokenizers, so compression fires before the request actually overflows.
   */
  needsCompression: boolean;
  /** Compression threshold (`maxWindowToken × thresholdRatio`) */
  threshold: number;
}

/**
 * Check if the upcoming request needs compression.
 *
 * Pass the exact prompt the caller is about to send — after the context engine
 * has assembled the preamble — so the estimate matches the real request body.
 * Attachment text is fitted into the remaining room first (see
 * {@link planAttachmentPreviews}), so attachments alone never trigger
 * compression; the estimate reflects the planned previews.
 */
export function shouldCompress(
  messages: UIChatMessage[],
  options: TokenCountOptions = {},
): CompressionCheckResult {
  const threshold = getCompressionThreshold(options);
  const drift = options.driftMultiplier ?? DEFAULT_DRIFT_MULTIPLIER;
  const overhead = options.overheadTokens ?? 0;

  // Plan attachments against the room the preamble leaves. When the caller
  // already folded the tool schemas into `overheadTokens`, do not count them a
  // second time here.
  const { accounting, previewFileIds } = planAttachmentPreviews({
    driftMultiplier: drift,
    messages,
    threshold: Math.max(0, threshold - overhead),
    tools: options.overheadTokens !== undefined ? undefined : options.tools,
  });

  const currentTokenCount = overhead + accounting.rawTotal;

  return {
    attachmentPreviewFileIds: [...previewFileIds],
    currentTokenCount,
    needsCompression: overhead + accounting.adjustedTotal > threshold,
    threshold,
  };
}
