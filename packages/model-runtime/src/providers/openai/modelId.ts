export type OpenAIModelIdSource = 'codex' | 'openRouter' | 'openai';

export interface ParsedOpenAIModelId {
  family: 'gpt';
  majorVersion: number;
  minorVersion?: number;
  modifiers: string[];
  normalizedModelId: string;
  source: OpenAIModelIdSource;
}

interface ExtractedOpenAIModelId {
  normalizedModelId: string;
  source: OpenAIModelIdSource;
}

export const systemToUserModels = new Set([
  'o1-preview',
  'o1-preview-2024-09-12',
  'o1-mini',
  'o1-mini-2024-09-12',
]);

// TODO: temporary implementation, needs to be refactored into model card display configuration
export const disableStreamModels = new Set([
  'o1',
  'o1-2024-12-17',
  'o1-pro',
  'o1-pro-2025-03-19',
  /*
  Official documentation shows no support, but actual testing shows Streaming is supported, temporarily commented out
  'o3-pro',
  'o3-pro-2025-06-10',
  */
  'computer-use-preview',
  'computer-use-preview-2025-03-11',
]);

// Static Responses API-only exceptions that do not follow the parsed GPT-5 rule.
export const responsesAPIModels = new Set([
  'o1-pro',
  'o1-pro-2025-03-19',
  'o3-deep-research',
  'o3-deep-research-2025-06-26',
  'o3-pro',
  'o3-pro-2025-06-10',
  'o4-mini-deep-research',
  'o4-mini-deep-research-2025-06-26',
  'codex-mini-latest',
  'computer-use-preview',
  'computer-use-preview-2025-03-11',
]);

/**
 * The major version is a single digit on purpose. Azure's legacy deployment name for
 * GPT-3.5 drops the dot (`gpt-35-turbo`), and a `\d+` major would read that as major
 * version 35 — which then satisfies every `majorVersion >= 5` reasoning-era check and
 * wrongly routes a 2023 chat model to the Responses API.
 */
const GPT_MODEL_PATTERN =
  /^gpt-(\d)(?:\.(\d+))?(?:\b|[-.:])(?:-([a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*))?/;

/**
 * Codex-compatible gateways namespace OpenAI models as `codex/gpt-*`. These models still use
 * the Responses contract, so capability detection must preserve that namespace separately from
 * OpenRouter's `openai/*` model IDs.
 *
 * @see https://github.com/lobehub/lobehub/issues/17831
 */
const CODEX_NAMESPACE = 'codex';
const OPENROUTER_NAMESPACE = 'openai';
const CODEX_MODEL_PREFIX = `${CODEX_NAMESPACE}/`;
const OPENROUTER_OPENAI_MODEL_PREFIX = `${OPENROUTER_NAMESPACE}/`;

/** What an OpenAI model id may start with, whichever namespace it arrives inside. */
const OPENAI_MODEL_NAME = /^(?:gpt-|o[134]|codex|computer-use)/;

/**
 * A gateway hands out ids namespaced by the slot it serves the model from: magpie's `group/`
 * and `auto/` routing groups, its `remote-magpie/` namespace in front of those, a vendor's own
 * slot (`workbuddy/`). The model behind such an id still answers on the protocol its own name
 * implies, so the namespaces have to come off before any rule can read it.
 *
 * The search stops at the first segment that names an OpenAI model, or at `codex` / `openai`
 * when one appears further in (`remote-magpie/codex/gpt-6.1-sol`). Those two are kept: they
 * carry a source of their own (`codex`) or are OpenRouter's convention for the same slug
 * (`openai`), which routes through Chat Completions despite its OpenAI-looking name.
 */
const stripGatewayNamespace = (normalized: string): string => {
  const segments = normalized.split('/');
  if (segments.length < 2) return normalized;

  const [first] = segments;
  if (first === CODEX_NAMESPACE || first === OPENROUTER_NAMESPACE) return normalized;

  for (let index = 1; index < segments.length; index++) {
    const segment = segments[index];
    if (segment === CODEX_NAMESPACE || segment === OPENROUTER_NAMESPACE) {
      return segments.slice(index).join('/');
    }
    if (OPENAI_MODEL_NAME.test(segment)) return segments.slice(index).join('/');
  }

  return normalized;
};

/**
 * The id a static rule set is keyed by: the gateway namespaces off, `codex/` off, `openai/`
 * kept — the same split {@link extractOpenAIModelId} makes, so an id either source names its
 * model the same way here.
 */
const staticRuleModelId = (model: string): string => {
  const stripped = stripGatewayNamespace(model.trim().toLowerCase());

  return stripped.startsWith(CODEX_MODEL_PREFIX)
    ? stripped.slice(CODEX_MODEL_PREFIX.length)
    : stripped;
};

const normalizeOpenAIModelId = (model: string): string | undefined => {
  const normalized = model.trim().toLowerCase();
  if (!normalized) return;

  const stripped = stripGatewayNamespace(normalized);

  if (stripped.startsWith(CODEX_MODEL_PREFIX)) {
    return stripped.slice(CODEX_MODEL_PREFIX.length);
  }

  return stripped.startsWith(OPENROUTER_OPENAI_MODEL_PREFIX)
    ? stripped.slice(OPENROUTER_OPENAI_MODEL_PREFIX.length)
    : stripped;
};

const extractOpenAIModelId = (model: string): ExtractedOpenAIModelId | undefined => {
  const normalized = model.trim().toLowerCase();
  if (!normalized) return;

  const stripped = stripGatewayNamespace(normalized);

  if (stripped.startsWith(CODEX_MODEL_PREFIX)) {
    return { normalizedModelId: stripped.slice(CODEX_MODEL_PREFIX.length), source: 'codex' };
  }

  if (stripped.startsWith(OPENROUTER_OPENAI_MODEL_PREFIX)) {
    return {
      normalizedModelId: stripped.slice(OPENROUTER_OPENAI_MODEL_PREFIX.length),
      source: 'openRouter',
    };
  }

  if (stripped.startsWith('gpt-')) {
    return { normalizedModelId: stripped, source: 'openai' };
  }
};

const parseMinorVersion = (
  value: string | undefined,
): Pick<ParsedOpenAIModelId, 'minorVersion'> => {
  if (!value) return {};

  return {
    minorVersion: Number(value),
  };
};

const parseModifiers = (value: string | undefined): Pick<ParsedOpenAIModelId, 'modifiers'> => ({
  modifiers: value ? value.split('-') : [],
});

export const parseOpenAIModelId = (model: string): ParsedOpenAIModelId | undefined => {
  const extracted = extractOpenAIModelId(model);
  if (!extracted) return;

  const match = GPT_MODEL_PATTERN.exec(extracted.normalizedModelId);
  if (!match) return;

  const [, majorVersion, minorVersion, modifiers] = match;

  return {
    family: 'gpt',
    majorVersion: Number(majorVersion),
    normalizedModelId: extracted.normalizedModelId,
    source: extracted.source,
    ...parseMinorVersion(minorVersion),
    ...parseModifiers(modifiers),
  };
};

/**
 * GPT-5 is the first generation that switched to the reasoning-model contract
 * (reasoning payload, no temperature/top_p, Responses endpoint). Every later
 * major version — GPT-6 and beyond — inherits that contract, so gate on
 * `majorVersion >= 5` instead of pinning to 5.
 */
const isReasoningEraGPTModel = (model: string): ParsedOpenAIModelId | undefined => {
  const parsed = parseOpenAIModelId(model);
  if (!parsed || parsed.majorVersion < 5) return;

  return parsed;
};

const isResponsesEndpointGPTModel = (model: string): ParsedOpenAIModelId | undefined => {
  const parsed = isReasoningEraGPTModel(model);
  if (!parsed || parsed.source === 'openRouter') return;

  return parsed;
};

const hasModifier = (parsed: ParsedOpenAIModelId, modifier: string): boolean =>
  parsed.modifiers.includes(modifier);

const baseGPT5MiniResponsesModels = new Set(['gpt-5-mini', 'gpt-5-mini-2025-08-07']);

export const isGPTResponsesModel = (model: string): boolean => {
  const parsed = isResponsesEndpointGPTModel(model);
  if (!parsed) return false;

  if (hasModifier(parsed, 'chat')) return false;
  if (hasModifier(parsed, 'codex') || hasModifier(parsed, 'pro')) return true;
  if (baseGPT5MiniResponsesModels.has(parsed.normalizedModelId)) return true;

  /**
   * GPT-6+ models only support tool calling on the Responses endpoint, so route
   * both base and minor-version models through it.
   *
   * @see https://developers.openai.com/docs/guides/latest-model
   */
  if (parsed.majorVersion >= 6) return true;

  return parsed.minorVersion !== undefined && parsed.minorVersion >= 2;
};

export const isResponsesAPIModel = (model: string): boolean =>
  responsesAPIModels.has(staticRuleModelId(model)) || isGPTResponsesModel(model);

export const isGPTProResponsesModel = (model: string): boolean => {
  const parsed = isResponsesEndpointGPTModel(model);
  return !!parsed && hasModifier(parsed, 'pro');
};

/**
 * `reasoning.effort: 'none'` is a GPT-5.x-only affordance. GPT-5 Pro never
 * supported it, and GPT-6+ models removed it — their lowest effort is `low`.
 *
 * @see https://developers.openai.com/docs/guides/latest-model
 */
export const supportsGPTResponsesReasoningEffortNone = (model: string): boolean => {
  const parsed = isResponsesEndpointGPTModel(model);
  if (!parsed || parsed.majorVersion !== 5 || parsed.minorVersion === undefined) return false;

  return !hasModifier(parsed, 'pro');
};

export const isOpenAIReasoningPayloadModel = (model: string): boolean => {
  const normalizedModelId = normalizeOpenAIModelId(model);
  if (!normalizedModelId) return false;

  return (
    !!isReasoningEraGPTModel(model) ||
    /^(?:o[134]|codex|computer-use)(?:$|[-.:])/.test(normalizedModelId)
  );
};

export const isOpenAIComputerUseModel = (model: string): boolean => {
  const normalizedModelId = normalizeOpenAIModelId(model);
  return !!normalizedModelId && /^computer-use(?:$|[-.:])/.test(normalizedModelId);
};

export const supportsOpenAIServiceTierFlex = (model: string): boolean => {
  const normalizedModelId = normalizeOpenAIModelId(model);
  if (!normalizedModelId) return false;

  if (isReasoningEraGPTModel(model)) return true;
  if (/^o3-mini(?:$|[-.:])/.test(normalizedModelId)) return false;

  return /^(?:o3|o4-mini)(?:$|[-.:])/.test(normalizedModelId);
};
