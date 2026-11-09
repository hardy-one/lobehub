import { estimateTokenCount } from 'tokenx';

/**
 * Estimate the input tokens of an assembled, provider-shaped request — the
 * message list the LLM transport will actually send (OpenAI `ChatStreamPayload`
 * messages: `role`, `content` (string or multimodal parts), `tool_calls`,
 * `tool_call_id`) plus the top-level tool schemas.
 *
 * This is the budget measurement the compression trigger must use: unlike the
 * UI-oriented {@link countContextTokens} (which reads `msg.tools` and the
 * display message shape), it counts what the provider tokenizes — including
 * `tool_calls` arguments and image/audio parts — so it can be shared by both the
 * server and browser request-prep layers without depending on a provider SDK.
 */
export interface EstimateRequestInputTokensOptions {
  /** Fixed token cost per audio part when its duration is unknown. */
  audioTokenEstimate?: number;
  /** Fixed token cost per image part (default 1000, matching the UI estimate). */
  imageTokenEstimate?: number;
  /** Top-level tool definitions sent alongside the messages. */
  tools?: unknown[];
  /** Fixed token cost per video part (default 1000). */
  videoTokenEstimate?: number;
}

const DEFAULT_IMAGE_INPUT_TOKENS = 1000;
const DEFAULT_VIDEO_INPUT_TOKENS = 1000;
const DEFAULT_AUDIO_INPUT_TOKENS = 1000;

const estimateSerializable = (value: unknown): number => {
  if (value == null) return 0;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text ? estimateTokenCount(text) : 0;
};

export const estimateRequestInputTokens = (
  messages: ReadonlyArray<Record<string, any>>,
  options: EstimateRequestInputTokensOptions = {},
): number => {
  const imageTokens = options.imageTokenEstimate ?? DEFAULT_IMAGE_INPUT_TOKENS;
  const videoTokens = options.videoTokenEstimate ?? DEFAULT_VIDEO_INPUT_TOKENS;
  const audioTokens = options.audioTokenEstimate ?? DEFAULT_AUDIO_INPUT_TOKENS;

  let total = 0;
  for (const message of messages) {
    total += estimateSerializable(message.role);
    total += estimateSerializable(message.name);
    total += estimateSerializable(message.tool_call_id);
    total += estimateSerializable(message.tool_calls);
    total += estimateSerializable(message.reasoning?.content);

    const { content } = message;
    if (typeof content === 'string') {
      total += estimateSerializable(content);
      continue;
    }
    if (!Array.isArray(content)) {
      total += estimateSerializable(content);
      continue;
    }
    for (const part of content) {
      switch (part?.type) {
        case 'text': {
          total += estimateSerializable(part.text);
          break;
        }
        case 'image_url': {
          total += imageTokens;
          break;
        }
        case 'video_url': {
          total += videoTokens;
          break;
        }
        case 'audio_url': {
          total += audioTokens;
          break;
        }
        default: {
          total += estimateSerializable(part);
        }
      }
    }
  }

  total += estimateSerializable(options.tools);
  return total;
};
