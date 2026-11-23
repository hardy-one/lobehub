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
 * The OpenAI and Anthropic routes reach the same gateway through its unified
 * prefixes — the legacy `/zen/v1` and `/zen/go/v1`, or the documented
 * `/inference/openai/v1` and `/inference/go/openai/v1`. A unified prefix
 * translates chat/completions, responses and messages, but it has no `/v1beta`
 * surface: a Gemini model pointed there asks for `<base>/v1beta/models/...`,
 * which the gateway answers with 404. The native Gemini surface is the `google`
 * family prefix beside it.
 *
 * refs:
 * - https://opencode.ai/v2/docs/console/api/inference/
 * - models.dev `opencode` / `opencode-go`: their Gemini models declare
 *   `@ai-sdk/google` with `.../inference[/go]/google/v1beta`
 */
const GEMINI_FAMILY_PREFIXES = [
  // Go first: `/zen/go/v1` also carries the `/zen/` segment the Zen rewrite looks at.
  { gemini: '/inference/go/google', union: ['/zen/go/v1', '/inference/go/openai/v1'] },
  { gemini: '/inference/google', union: ['/zen/v1', '/inference/openai/v1'] },
];

export const DEFAULT_OPENCODE_GEMINI_BASE_URL = 'https://opencode.ai/inference/google';

/**
 * Map the configured gateway base URL onto the native Gemini family prefix.
 *
 * - a unified gateway prefix (`/zen/v1`, `/inference/openai/v1`, `/zen/go/v1`,
 *   `/inference/go/openai/v1`) → the Gemini family prefix beside it
 * - a base URL that already names a Gemini surface is kept as-is
 * - any other custom proxy base URL is left untouched, so a deployment that
 *   serves `/v1beta` under its own root keeps working
 */
export const resolveOpenCodeGeminiBaseURL = (baseURL?: string): string => {
  const trimmed = baseURL?.trim().replace(/\/+$/, '');
  if (!trimmed) return DEFAULT_OPENCODE_GEMINI_BASE_URL;

  for (const { gemini, union } of GEMINI_FAMILY_PREFIXES) {
    const matched = union.find((suffix) => trimmed.endsWith(suffix));
    if (matched) return `${trimmed.slice(0, -matched.length)}${gemini}`;
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
