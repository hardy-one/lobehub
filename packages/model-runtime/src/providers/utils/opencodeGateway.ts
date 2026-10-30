import type {
  ChatMethodOptions,
  ChatStreamPayload,
  GenerateObjectOptions,
  GenerateObjectPayload,
} from '../../types';
import { LobeGoogleAI } from '../google';

/**
 * OpenCode serves each wire protocol family from its own gateway prefix, e.g.
 *
 *   https://opencode.ai/inference/openai/v1/chat/completions
 *   https://opencode.ai/inference/anthropic/v1/messages
 *   https://opencode.ai/inference/google/v1beta/models/{model}:generateContent
 *
 * The unified legacy prefixes that the OpenAI and Anthropic routes still use
 * (`/zen/v1` and `/zen/go/v1`) expose chat/completions, responses and messages only:
 * a Gemini model pointed there asks for `<base>/v1beta/models/...`, which the gateway
 * answers with 404. The native Gemini surface lives under `/inference[/go]/google`.
 *
 * ref: https://opencode.ai/v2/docs/console/api/inference/
 */
const ZEN_UNION_SUFFIX = '/zen/v1';
const GO_UNION_SUFFIX = '/zen/go/v1';
const ZEN_GEMINI_SUFFIX = '/inference/google';
const GO_GEMINI_SUFFIX = '/inference/go/google';

export const DEFAULT_OPENCODE_GEMINI_BASE_URL = 'https://opencode.ai/inference/google';

/**
 * Map the configured gateway base URL onto the native Gemini family prefix.
 *
 * - `/zen/v1` → `/inference/google`, `/zen/go/v1` → `/inference/go/google`
 * - a base URL that already names a Gemini surface is kept as-is
 * - any other custom proxy base URL is left untouched, so a deployment that
 *   serves `/v1beta` under its own root keeps working
 */
export const resolveOpenCodeGeminiBaseURL = (baseURL?: string): string => {
  const trimmed = baseURL?.trim().replace(/\/+$/, '');
  if (!trimmed) return DEFAULT_OPENCODE_GEMINI_BASE_URL;

  // Go first: `/zen/go/v1` also contains the `/zen/` segment the Zen rewrite looks at.
  if (trimmed.endsWith(GO_UNION_SUFFIX)) {
    return `${trimmed.slice(0, -GO_UNION_SUFFIX.length)}${GO_GEMINI_SUFFIX}`;
  }
  if (trimmed.endsWith(ZEN_UNION_SUFFIX)) {
    return `${trimmed.slice(0, -ZEN_UNION_SUFFIX.length)}${ZEN_GEMINI_SUFFIX}`;
  }

  return trimmed;
};

/**
 * Gemini runtime for the OpenCode gateways.
 *
 * The Google SDK only sends headers configured on its client, so a Gemini request
 * gets a client bound to the caller's per-request headers: the gateways route and
 * cache traffic by `x-opencode-session` and Go rejects requests without it.
 */
export class OpenCodeGeminiRuntime extends LobeGoogleAI {
  override async chat(payload: ChatStreamPayload, options?: ChatMethodOptions) {
    return this.withHeaders(options?.requestHeaders).chat(payload, options);
  }

  override async generateObject(payload: GenerateObjectPayload, options?: GenerateObjectOptions) {
    return this.withHeaders(options?.headers).generateObject(payload, options);
  }

  private withHeaders(headers?: Record<string, any>): LobeGoogleAI {
    if (!headers || Object.keys(headers).length === 0) return this;

    return new LobeGoogleAI({
      apiKey: this.apiKey,
      baseURL: this.baseURL,
      defaultHeaders: headers,
      id: this.provider,
    });
  }
}
