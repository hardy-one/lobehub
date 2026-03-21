import { estimateTokenCount } from 'tokenx';

/**
 * Options for token counting and compression threshold calculation
 */
export interface TokenCountOptions {
  /** Model's max context window token count */
  maxWindowToken?: number;
  /** Threshold ratio for triggering compression, default 0.75 */
  thresholdRatio?: number;
}

/** Default max context window (128k tokens) */
export const DEFAULT_MAX_CONTEXT = 128_000;

/**
 * Minimum buffer required for compression process
 *
 * Compression needs:
 * - Input messages (at threshold): ~threshold tokens
 * - Compressed output: ~30-40% of input
 * - System prompt: ~800 tokens
 *
 * For 128k context at 70%: 89.6k (input) + ~30k (output) + 800 ≈ 120k < 128k (safe)
 * For 32k context at 70%: 22.4k (input) + ~8k (output) + 800 ≈ 31.2k > 32k (NOT safe)
 *
 * Setting MIN_COMPRESSION_BUFFER to 20k ensures:
 * - Small context models (≤64k) have enough buffer for compression
 * - Large context models (≥128k) still use the optimal 70% threshold
 */
export const MIN_COMPRESSION_BUFFER = 20_000;

/**
 * Default threshold ratio (70% of max context)
 *
 * Rationale:
 * - 70% provides a good balance between utilizing context window and leaving room for compression
 * - At 70% of 128k = 89.6k, compression needs ~89.6k (input) + ~27k (output) ≈ 117k < 128k (safe)
 * - At 70% of 200k = 140k, compression needs ~140k (input) + ~42k (output) ≈ 182k < 200k (safe)
 * - Higher than 50% to avoid premature compression, but lower than 90% to ensure compression process has buffer
 */
export const DEFAULT_THRESHOLD_RATIO = 0.7;

/**
 * Message interface for token counting
 */
export interface TokenCountMessage {
  content?: string | unknown;
  metadata?: {
    usage?: {
      totalOutputTokens?: number;
    };
  } | null;
  role: string;
}

/**
 * Estimate token count for text content using tokenx
 * @param content - Text content or object to estimate tokens for
 * @returns Estimated token count
 */
export function estimateTokens(content: string | unknown): number {
  // Handle null/undefined early
  if (content === null || content === undefined) return 0;

  const text = typeof content === 'string' ? content : JSON.stringify(content);
  if (!text) return 0;
  return estimateTokenCount(text);
}

/**
 * Calculate total token count for a list of messages
 * - Assistant messages: Use metadata.usage.totalOutputTokens if available (exact value)
 * - User/System messages: Use tokenx estimation
 *
 * @param messages - List of messages to count tokens for
 * @returns Total token count
 */
export function calculateMessageTokens(messages: TokenCountMessage[]): number {
  return messages.reduce((total, msg) => {
    // For assistant messages, prefer the recorded token count from usage metadata
    if (msg.role === 'assistant') {
      const outputTokens = msg.metadata?.usage?.totalOutputTokens;
      if (outputTokens && outputTokens > 0) {
        return total + outputTokens;
      }
    }

    // For user/system messages or assistant messages without usage data, estimate tokens
    return total + estimateTokens(msg.content);
  }, 0);
}

/**
 * Calculate the compression threshold based on max context window
 *
 * Applies minimum buffer protection for small context models:
 * - For models with context ≤ 20k: disabled (returns maxContext, effectively disabling auto-compression)
 * - For models with context ≤ 64k: uses conservative threshold to ensure 20k buffer
 * - For models with context ≥ 128k: uses optimal 70% threshold
 *
 * @param options - Token count options
 * @returns Compression threshold in tokens
 */
export function getCompressionThreshold(options: TokenCountOptions = {}): number {
  const maxContext = options.maxWindowToken ?? DEFAULT_MAX_CONTEXT;
  const ratio = options.thresholdRatio ?? DEFAULT_THRESHOLD_RATIO;
  const threshold = Math.floor(maxContext * ratio);

  // Ensure minimum buffer for compression process
  // Compression needs: input (threshold) + output (~35% of input) + system prompt (~800)
  const maxSafeThreshold = maxContext - MIN_COMPRESSION_BUFFER;

  // For very small context models (< 20k), disable auto-compression
  // as there's not enough room for meaningful compression
  if (maxSafeThreshold <= 0) {
    return maxContext; // Return max to effectively disable compression
  }

  return Math.min(threshold, maxSafeThreshold);
}

/**
 * Result of compression check
 */
export interface CompressionCheckResult {
  /** Current total token count */
  currentTokenCount: number;
  /** Whether compression is needed */
  needsCompression: boolean;
  /** Compression threshold */
  threshold: number;
}

/**
 * Check if messages need compression based on token count
 * @param messages - List of messages to check
 * @param options - Token count options
 * @returns Compression check result
 */
export function shouldCompress(
  messages: TokenCountMessage[],
  options: TokenCountOptions = {},
): CompressionCheckResult {
  const currentTokenCount = calculateMessageTokens(messages);
  const threshold = getCompressionThreshold(options);

  return {
    currentTokenCount,
    needsCompression: currentTokenCount > threshold,
    threshold,
  };
}
