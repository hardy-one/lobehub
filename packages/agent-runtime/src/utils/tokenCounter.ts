import { DEFAULT_DRIFT_MULTIPLIER, planAttachmentPreviews } from '@lobechat/context-engine';
import type { UIChatMessage } from '@lobechat/types';

/**
 * Options for token counting and compression threshold calculation
 */
export interface TokenCountOptions {
  /**
   * Id of the last message covered by `baselineTokens`. The anchor must still
   * be present in `messages`; otherwise the whole set is estimated instead.
   */
  baselineLastMsgId?: string;
  /**
   * Provider-measured input tokens of an earlier completed request on this
   * conversation. When it is available the estimate becomes
   *
   *     baselineTokens + estimate(messages after the anchor)
   *
   * so the history portion carries no estimation error, and the parts the
   * estimate cannot see at all (system role, memory, tool schemas assembled
   * after the budget is taken) are already inside the measured value.
   */
  baselineTokens?: number;
  /**
   * Optional drift multiplier override forwarded to {@link countContextTokens}.
   * Default {@link DEFAULT_DRIFT_MULTIPLIER} (1.25).
   */
  driftMultiplier?: number;
  /** Model's max context window token count */
  maxWindowToken?: number;
  /** Threshold ratio for triggering compression, default 0.75 */
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

/**
 * Default threshold ratio (75% of max context). The remaining quarter of the
 * window is what the trigger cannot see: the server-side context engineering
 * (system role, knowledge, memories, skills) is assembled after this budget is
 * taken, and the completion still needs room under the same window.
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
  /** Compression threshold (`maxWindowToken × thresholdRatio`) */
  threshold: number;
}

/**
 * Check if messages need compression based on token count.
 *
 * Uses {@link countContextTokens} under the hood, so the input estimate
 * accounts for tool calls, reasoning, and tool definitions in addition to
 * `content` (see for the calibration data). Attachment text is fitted into the
 * remaining room first (see {@link planAttachmentPreviews}), so attachments
 * alone never trigger compression; the estimate reflects the planned previews.
 */
export function shouldCompress(
  messages: UIChatMessage[],
  options: TokenCountOptions = {},
): CompressionCheckResult {
  const threshold = getCompressionThreshold(options);
  const drift = options.driftMultiplier ?? DEFAULT_DRIFT_MULTIPLIER;

  // Baseline path: the provider already measured this conversation up to the
  // anchor, including the preamble (system role, memory, tool schemas) that the
  // estimate below cannot see. Only what was added since then is estimated.
  //
  // The anchor is the assistant message the measured request produced. The
  // runtime rehydrates a turn into an `assistantGroup` container, so the anchor
  // may sit among its children; in that case the delta starts after that child
  // instead of after the whole group.
  const { baselineLastMsgId, baselineTokens } = options;
  const anchorIndex =
    typeof baselineTokens === 'number' &&
    baselineTokens > 0 &&
    typeof baselineLastMsgId === 'string'
      ? messages.findIndex(
          (message) =>
            message.id === baselineLastMsgId ||
            (message.children ?? []).some((child: any) => child?.id === baselineLastMsgId),
        )
      : -1;

  if (anchorIndex >= 0 && typeof baselineTokens === 'number') {
    const anchor = messages[anchorIndex] as UIChatMessage & { children?: any[] };
    const childIndex = (anchor.children ?? []).findIndex(
      (child: any) => child?.id === baselineLastMsgId,
    );
    const remainingChildren = childIndex >= 0 ? anchor.children!.slice(childIndex + 1) : undefined;
    // An emptied container would otherwise be counted for its (empty) content,
    // so it is dropped instead of kept as a shell.
    const deltaMessages = (
      childIndex < 0
        ? messages.slice(anchorIndex + 1)
        : [
            ...(remainingChildren!.length > 0 ? [{ ...anchor, children: remainingChildren }] : []),
            ...messages.slice(anchorIndex + 1),
          ]
    ) as UIChatMessage[];

    // Same attachment fitting as the estimate path, against the room the
    // measured baseline leaves. Tool schemas are already inside the baseline,
    // so they are not counted again here.
    const plan = planAttachmentPreviews({
      driftMultiplier: drift,
      messages: deltaMessages,
      threshold: Math.max(0, threshold - baselineTokens),
    });

    return {
      attachmentPreviewFileIds: [...plan.previewFileIds],
      currentTokenCount: baselineTokens + plan.accounting.rawTotal,
      needsCompression: baselineTokens + plan.accounting.adjustedTotal > threshold,
      threshold,
    };
  }

  const { accounting, previewFileIds } = planAttachmentPreviews({
    driftMultiplier: drift,
    messages,
    threshold,
    tools: options.tools,
  });

  return {
    attachmentPreviewFileIds: [...previewFileIds],
    currentTokenCount: accounting.rawTotal,
    needsCompression: accounting.adjustedTotal > threshold,
    threshold,
  };
}
