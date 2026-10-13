import { pickNonEmptyString } from '@lobechat/utils/object';
import { ModelProvider, opencodecodingplan } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { createRouterRuntime } from '../../core/RouterRuntime';
import type { CreateRouterRuntimeOptions } from '../../core/RouterRuntime/createRuntime';
import type {
  ChatMethodOptions,
  ChatStreamPayload,
  GenerateObjectOptions,
  GenerateObjectPayload,
} from '../../types';
import { processMultiProviderModelList } from '../../utils/modelParse';
import {
  isKimiNativeThinkingModel,
  isKimiReasoningEffortModel,
  isKimiReasoningModel,
} from '../moonshot/modelId';

// ============================================================================
// Constants
// ============================================================================

const GO_BASE_URL = 'https://opencode.ai/zen/go/v1';
const MODELS_DEV_URL = 'https://models.dev/api.json';

// ============================================================================
// Models.dev Types & Cache
// ============================================================================

interface ModelsDevModel {
  [key: string]: any;
  attachment?: boolean;
  cost?: {
    input?: number;
    output?: number;
    cache_read?: number;
    cache_write?: number;
  };
  family?: string;
  id: string;
  limit?: { context?: number; output?: number };
  modalities?: { input?: string[]; output?: string[] };
  name?: string;
  provider?: { npm?: string };
  reasoning?: boolean;
  release_date?: string;
  structured_output?: boolean;
  tool_call?: boolean;
}

interface ModelsDevData {
  [provider: string]: {
    models?: Record<string, ModelsDevModel>;
    npm?: string;
  };
}

interface ModelsCache {
  /**
   * Model IDs whose `interleaved.field` is set in models.dev. These need
   * special reasoning_content handling in the request payload.
   * Populated by `fetchModelsDevData` so it stays in sync with models.dev.
   */
  interleavedIds: Set<string>;
  modelsDev: Record<string, ModelsDevModel>;
}

// Fallback: models with interleaved reasoning_content (used when models.dev
// is unreachable). Mirrors the last-known state of models.dev.
const FALLBACK_INTERLEAVED_IDS: ReadonlySet<string> = new Set([
  'deepseek-v4-flash',
  'deepseek-v4-flash-vision-exp',
  'deepseek-v4-pro',
  'deepseek-v4.1-flash',
  'glm-5.2',
  'glm-5.3',
  'glm-5.3-flash',
  'kimi-k2.6',
  'kimi-k2.7-code',
  'kimi-k3',
  'longcat-2.0',
  'longcat-2.5-preview-free',
  'mimo-v2.5',
  'mimo-v2.5-pro',
  'mimo-v2.6-flash',
  'mimo-v2.6-pro',
  'space-bunny',
  'space-bunny-free',
  'step-5-preview-free',
]);

let cachedModelsData: ModelsCache | null = null;

// ============================================================================
// Models.dev Fetcher
// ============================================================================

/**
 * Fetch models.dev data and derive the fields this provider needs:
 *   - `interleavedIds`   (models with `interleaved.field` set, needing
 *                         special reasoning_content handling)
 *   - `modelsDev`        (raw model map for enrichment and output limits)
 *
 * The result is cached for the process lifetime, so a single successful
 * fetch keeps every derived field in sync with models.dev.
 */
const fetchModelsDevData = async (): Promise<ModelsCache> => {
  if (cachedModelsData) return cachedModelsData;

  try {
    const res = await fetch(MODELS_DEV_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data: ModelsDevData = await res.json();
    const models = data?.['opencode-go']?.models;
    if (!models || typeof models !== 'object') {
      throw new Error('opencode-go provider not found in models.dev');
    }

    const interleavedIds = new Set<string>();
    for (const m of Object.values(models)) {
      if (m?.interleaved?.field) interleavedIds.add(m.id);
    }

    cachedModelsData = { interleavedIds, modelsDev: models };
    return cachedModelsData;
  } catch {
    cachedModelsData = { interleavedIds: new Set(), modelsDev: {} };
    return cachedModelsData;
  }
};

/**
 * Sync accessor for the interleaved model set. Returns the cached value
 * populated by `fetchModelsDevData`; falls back to a hardcoded snapshot of
 * models.dev's last-known state when the cache hasn't been populated yet
 * (e.g. the very first chat request before any models.dev fetch has run).
 */
const getInterleavedModelIds = (): ReadonlySet<string> => {
  if (cachedModelsData && cachedModelsData.interleavedIds.size > 0) {
    return cachedModelsData.interleavedIds;
  }
  return FALLBACK_INTERLEAVED_IDS;
};

/**
 * Output limit for a model: the models.dev value fetched by the model-list path
 * wins, falling back to the static model-bank card so a cold cache still gets a
 * limit on the first request.
 */
const getModelMaxOutput = (model?: string): number | undefined => {
  if (!model) return undefined;

  return (
    cachedModelsData?.modelsDev?.[model]?.limit?.output ??
    opencodecodingplan.find((item) => item.id === model)?.maxOutput
  );
};

// ============================================================================
// Models.dev → Model Card Enrichment
// ============================================================================

/**
 * Map a models.dev model entry to the flat fields understood by
 * `processModelCard`. Fields not provided by models.dev (description,
 * organization, settings, etc.) are filled in from the static model-bank
 * entry via the knownModel fallback in processModelCard.
 *
 * Pricing is passed in the flat `input` / `output` / `cachedInput` /
 * `writeCacheInput` shape; processModelCard's `formatPricing` converts it
 * into the new `units` array.
 */
const enrichWithModelsDev = (
  id: string,
  dev?: ModelsDevModel,
): { id: string; [key: string]: any } => {
  if (!dev) return { id };

  const inputModalities = dev.modalities?.input ?? [];
  const cost = dev.cost;
  const limit = dev.limit;

  return {
    id,
    displayName: dev.name,
    contextWindowTokens: limit?.context,
    maxOutput: limit?.output,
    releasedAt: dev.release_date,
    functionCall: dev.tool_call || undefined,
    reasoning: dev.reasoning || undefined,
    vision: inputModalities.includes('image') || undefined,
    structuredOutput: dev.structured_output || undefined,
    pricing: cost
      ? {
          input: cost.input,
          output: cost.output,
          cachedInput: cost.cache_read,
          writeCacheInput: cost.cache_write,
        }
      : undefined,
  };
};

// ============================================================================
// Reasoning Content Helpers
// ============================================================================

// Kimi dot-versioned k2 models (k2.5+) and later generations (k3+) expose
// reasoning on the OpenAI-compatible route
const isKimiThinkingToggleModel = isKimiReasoningModel;

// Models in `interleavedIds` need:
//   1. reason → reasoning_content conversion
//   2. reasoning_content forced on all assistant messages
// The set is populated from models.dev by `fetchModelsDevData`; the fallback
// is used when models.dev hasn't been fetched yet.
// Ref: https://models.dev/api.json → opencode-go.interleaved
const isInterleavedModel = (model: string) => {
  for (const id of getInterleavedModelIds()) {
    if (model?.includes(id)) return true;
  }
  return false;
};

const hasValidReasoning = (reasoning: any) => typeof reasoning?.content === 'string';

const isEmptyContent = (content: any) =>
  content === '' || content === null || content === undefined;

// ============================================================================
// JSON Schema Sanitizer
// ============================================================================

/**
 * Recursively remove `null` values from `enum` arrays in a JSON Schema.
 * The opencode-go backend rejects nullable enums produced by Zod `.nullable()` / `.nullish()`.
 */
export const sanitizeJsonSchema = (schema: any): any => {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(sanitizeJsonSchema);

  const result: any = {};
  for (const [key, value] of Object.entries(schema)) {
    // Filter null from enum arrays
    if (key === 'enum' && Array.isArray(value)) {
      const filtered = value.filter((v: any) => v !== null);
      if (filtered.length > 0) result[key] = filtered;
      continue;
    }

    // type: ['string', 'null'] → type: 'string'
    if (key === 'type' && Array.isArray(value) && value.includes('null') && value.length >= 2) {
      const nonNullTypes = value.filter((v: any) => v !== 'null' && v !== null);
      if (nonNullTypes.length === 1) result.type = nonNullTypes[0];
      else if (nonNullTypes.length > 1) result.type = nonNullTypes;
      continue;
    }

    // Recurse into nested structures
    if (key === 'properties' || key === '$defs' || key === 'definitions') {
      const nested: any = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        nested[k] = sanitizeJsonSchema(v);
      }
      result[key] = nested;
    } else if (['allOf', 'anyOf', 'oneOf', 'prefixItems'].includes(key) && Array.isArray(value)) {
      result[key] = value.map(sanitizeJsonSchema);
    } else if (
      [
        'items',
        'additionalProperties',
        'not',
        'contains',
        'if',
        'then',
        'else',
        'unevaluatedItems',
        'unevaluatedProperties',
      ].includes(key)
    ) {
      result[key] = sanitizeJsonSchema(value);
    } else {
      result[key] = sanitizeJsonSchema(value);
    }
  }
  return result;
};

// ============================================================================
// Payload Builder
// ============================================================================

/**
 * Build the Responses API payload. Every OpenCode Go model is served through the
 * Responses endpoint, so this only normalizes model-family behaviour:
 *   - top up `max_tokens` from the model output limit when the caller left it open
 *   - drop the Chat Completions–only `thinking` switch, which Responses rejects
 *   - keep the interleaved / Kimi `reasoning_content` round-trip and the Kimi
 *     schema sanitizing the gateway requires
 */
export const buildResponsesPayload = (payload: ChatStreamPayload): ChatStreamPayload => {
  const model = payload.model;
  const isKimi = isKimiThinkingToggleModel(model);
  const interleaved = isInterleavedModel(model);

  // `thinking` only exists on the Chat Completions payload; Responses rejects it.
  const { max_tokens, reasoning_effort, thinking, ...restPayload } = payload;

  // Native-thinking Kimi models (k2.7-code, k3+) cannot turn reasoning off, so a
  // saved disabled-thinking setting is ignored: they still require the
  // reasoning_content round-trip.
  const nativeThinking = isKimiNativeThinkingModel(model);
  const thinkingExplicitlyDisabled = !nativeThinking && thinking?.type === 'disabled';
  const shouldForceReasoning = (interleaved || isKimi) && !thinkingExplicitlyDisabled;

  const messages = restPayload.messages.map((message: any) => {
    // Only the interleaved / Kimi families exchange the structured `reasoning` block for the
    // flat `reasoning_content` field. Every other model keeps `reasoning` untouched so the
    // Responses converter can replay its reasoning items.
    if (!isKimi && !interleaved) return message;

    const { reasoning, ...rest } = message;
    const normalized = isKimi && isEmptyContent(message.content) ? { ...rest, content: ' ' } : rest;

    const reasoningContent =
      typeof normalized.reasoning_content === 'string'
        ? normalized.reasoning_content
        : hasValidReasoning(reasoning)
          ? reasoning.content
          : undefined;

    if (message.role === 'assistant' && shouldForceReasoning) {
      return { ...normalized, reasoning_content: reasoningContent ?? ' ' };
    }

    if (reasoningContent !== undefined) {
      return { ...normalized, reasoning_content: reasoningContent };
    }

    return normalized;
  });

  // Sanitize response_format for Kimi models
  const response_format =
    isKimi &&
    restPayload.response_format &&
    'json_schema' in restPayload.response_format &&
    restPayload.response_format.json_schema?.schema
      ? {
          ...restPayload.response_format,
          json_schema: {
            ...restPayload.response_format.json_schema,
            schema: sanitizeJsonSchema(restPayload.response_format.json_schema.schema),
          },
        }
      : restPayload.response_format;

  // Sanitize tool parameters for Kimi models
  const tools =
    isKimi && restPayload.tools
      ? restPayload.tools.map((tool: any) => ({
          ...tool,
          function: {
            ...tool.function,
            parameters: tool.function?.parameters
              ? sanitizeJsonSchema(tool.function.parameters)
              : tool.function?.parameters,
          },
        }))
      : restPayload.tools;

  const resolvedMaxTokens = max_tokens ?? getModelMaxOutput(model);

  return {
    ...restPayload,
    messages,
    response_format,
    tools,
    // Top up the output limit from the model metadata when the caller left it open.
    ...(resolvedMaxTokens === undefined ? {} : { max_tokens: resolvedMaxTokens }),
    // Kimi K3+ only accepts reasoning_effort 'max' (also the server default) — drop
    // any other saved effort instead of sending a value the API rejects
    ...(reasoning_effort &&
    !thinkingExplicitlyDisabled &&
    (!isKimiReasoningEffortModel(model) || reasoning_effort === 'max')
      ? { reasoning_effort }
      : {}),
    stream: payload.stream ?? true,
  } as ChatStreamPayload;
};

// ============================================================================
// Runtime Instances
// ============================================================================

// OpenCode Go serves every model through the OpenAI-compatible Responses endpoint.
const LobeOpenCodeCodingPlanOpenAI = createOpenAICompatibleRuntime({
  provider: ModelProvider.OpenCodeCodingPlan,
  baseURL: GO_BASE_URL,
  debug: {
    chatCompletion: () => process.env.DEBUG_OPENCODE_GO_CHAT_COMPLETION === '1',
    responses: () => process.env.DEBUG_OPENCODE_GO_CHAT_COMPLETION === '1',
  },
  generateObject: { useResponse: true },
  responses: { handlePayload: buildResponsesPayload },
});

// ============================================================================
// Provider Export
// ============================================================================

export const params = {
  debug: {
    chatCompletion: () => process.env.DEBUG_OPENCODE_GO_CHAT_COMPLETION === '1',
  },
  id: ModelProvider.OpenCodeCodingPlan,
  models: async ({ client }) => {
    // Always pull models.dev for enrichment (cached after first call).
    const { modelsDev } = await fetchModelsDevData();

    try {
      // 1. Try API first (real-time available models), enriched with models.dev.
      const modelsPage = await (client as any).models.list();
      const apiModels = modelsPage.data || [];
      return processMultiProviderModelList(
        apiModels.map((m: { id: string }) => enrichWithModelsDev(m.id, modelsDev[m.id])),
        'opencodecodingplan',
      );
    } catch {
      // 2. Fallback to models.dev (if we got data) enriched with itself.
      const modelIds = Object.keys(modelsDev);
      if (modelIds.length > 0) {
        return processMultiProviderModelList(
          modelIds.map((id) => enrichWithModelsDev(id, modelsDev[id])),
          'opencodecodingplan',
        );
      }

      // 3. Final fallback: static model bank.
      return processMultiProviderModelList(
        opencodecodingplan.map((m) => ({ id: m.id })),
        'opencodecodingplan',
      );
    }
  },
  routers: (options) => [
    // Every model goes through the Responses endpoint, so there is no per-model route.
    {
      apiType: 'openai',
      runtime: LobeOpenCodeCodingPlanOpenAI as any,
      options: { ...options, baseURL: options.baseURL || GO_BASE_URL },
    },
  ],
} satisfies CreateRouterRuntimeOptions;

export class LobeOpenCodeCodingPlanAI extends createRouterRuntime(params) {
  private getSessionHeaders(metadata?: Record<string, unknown>) {
    return {
      'User-Agent': 'lobehub',
      'x-opencode-client': 'lobehub',
      // Callers preserve topic identity or reuse a task ID across related calls.
      // Only requests without either identity receive a standalone session.
      'x-opencode-session':
        pickNonEmptyString(metadata?.topicId) ??
        pickNonEmptyString(metadata?.taskId) ??
        crypto.randomUUID(),
    };
  }

  override async chat(payload: ChatStreamPayload, options?: ChatMethodOptions) {
    return super.chat(
      // The gateway is addressed through its Responses endpoint only; forcing the mode
      // here keeps a saved Chat Completions preference from switching the provider back.
      { ...payload, apiMode: 'responses' },
      {
        ...options,
        requestHeaders: {
          ...this.getSessionHeaders(options?.metadata),
          ...options?.requestHeaders,
        },
      },
    );
  }

  override async generateObject(payload: GenerateObjectPayload, options?: GenerateObjectOptions) {
    return super.generateObject(payload, {
      ...options,
      headers: {
        ...this.getSessionHeaders(options?.metadata),
        ...options?.headers,
      },
    });
  }
}
