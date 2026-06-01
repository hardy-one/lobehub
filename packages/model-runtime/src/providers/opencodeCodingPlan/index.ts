import { ModelProvider } from 'model-bank';
import type OpenAI from 'openai';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { createRouterRuntime } from '../../core/RouterRuntime';
import type { CreateRouterRuntimeOptions } from '../../core/RouterRuntime/createRuntime';
import type { ChatStreamPayload } from '../../types';
import { processMultiProviderModelList } from '../../utils/modelParse';

// ============================================================================
// Constants
// ============================================================================

const GO_BASE_URL = 'https://opencode.ai/zen/go/v1';
const MODELS_DEV_URL = 'https://models.dev/api.json';

// ============================================================================
// Models.dev Types & Cache
// ============================================================================

interface ModelsDevModel {
  id: string;
  family?: string;
  provider?: { npm?: string };
  cost?: { input?: number; output?: number; cache_read?: number };
  [key: string]: any;
}

interface ModelsDevData {
  [provider: string]: {
    models?: Record<string, ModelsDevModel>;
    npm?: string;
  };
}

interface ModelsCache {
  anthropicModels: string[];
  modelsDev: Record<string, ModelsDevModel>;
}

// Fallback: models that need Anthropic SDK (used when models.dev is unavailable)
const ANTHROPIC_MODEL_PREFIXES = ['minimax', 'qwen'];

let cachedModelsData: ModelsCache | null = null;

// ============================================================================
// Models.dev Fetcher
// ============================================================================

/**
 * Fetch models.dev data and extract SDK routing info.
 * Uses provider.npm field to determine which models need Anthropic SDK.
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

    const anthropicModels = Object.values(models)
      .filter((m) => m.provider?.npm === '@ai-sdk/anthropic')
      .map((m) => m.id);

    cachedModelsData = { anthropicModels, modelsDev: models };
    return cachedModelsData;
  } catch {
    return { anthropicModels: [], modelsDev: {} };
  }
};

/**
 * Get anthropic models with self-contained fallback chain:
 *   1. models.dev (authoritative `provider.npm` field)
 *   2. static model-bank prefix match (used when models.dev is unreachable)
 *
 * Self-contained: does not depend on a runtime `client` object, so it's safe
 * to call from `routers` (which receives `ClientOptions` only and has no
 * `client` property during normal chat routing).
 */
const getAnthropicModels = async (): Promise<string[]> => {
  const { anthropicModels, modelsDev } = await fetchModelsDevData();

  if (Object.keys(modelsDev).length > 0) {
    return anthropicModels;
  }

  // Fallback: prefix-match the static model-bank list. Equivalent to the
  // pre-refactor hard-coded behavior when models.dev is unreachable.
  try {
    const { opencodecodingplan } = await import('model-bank');
    return opencodecodingplan
      .map((m) => m.id)
      .filter((id) => ANTHROPIC_MODEL_PREFIXES.some((p) => id.startsWith(p)));
  } catch {
    return [];
  }
};

// ============================================================================
// Reasoning Content Helpers
// ============================================================================

// Kimi K2.x models expose reasoning on the OpenAI-compatible route
const isKimiThinkingToggleModel = (model: string) => model.startsWith('kimi-k2.');

// Models with interleaved reasoning_content that need:
//   1. reason → reasoning_content conversion
//   2. reasoning_content forced on all assistant messages
// Ref: https://models.dev/api.json → opencode-go
const reasoningInterleavedModels = [
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  'glm-5',
  'glm-5.1',
  'mimo-v2.5',
  'mimo-v2.5-pro',
  'qwen3.7-max',
];

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
    } else if (
      ['allOf', 'anyOf', 'oneOf', 'prefixItems'].includes(key) &&
      Array.isArray(value)
    ) {
      result[key] = value.map(sanitizeJsonSchema);
    } else if (
      ['items', 'additionalProperties', 'not', 'contains', 'if', 'then', 'else',
       'unevaluatedItems', 'unevaluatedProperties'].includes(key)
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
 * Build OpenAI-compatible payload with reasoning_content handling.
 * Applies to models with interleaved reasoning_content and Kimi K2.x models.
 */
const buildOpenAIPayload = (
  payload: ChatStreamPayload,
): OpenAI.ChatCompletionCreateParamsStreaming => {
  const model = payload.model;
  const isKimi = isKimiThinkingToggleModel(model);
  const isInterleavedModel = reasoningInterleavedModels.some((m) => model?.includes(m));

  if (!isKimi && !isInterleavedModel) return payload as any;

  const thinkingExplicitlyDisabled = (payload as any).thinking?.type === 'disabled';
  const shouldForceReasoning = (isInterleavedModel || isKimi) && !thinkingExplicitlyDisabled;

  const messages = payload.messages.map((message: any) => {
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

  const { reasoning_effort, thinking, ...restPayload } = payload;

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

  return {
    ...restPayload,
    messages,
    response_format,
    tools,
    ...(!thinkingExplicitlyDisabled && reasoning_effort ? { reasoning_effort } : {}),
    ...(thinking?.type === 'enabled' || thinking?.type === 'disabled'
      ? { thinking: { type: thinking.type } }
      : {}),
    stream: payload.stream ?? true,
  } as OpenAI.ChatCompletionCreateParamsStreaming;
};

// ============================================================================
// Runtime Instances
// ============================================================================

// OpenAI-compatible runtime for non-Anthropic models
const LobeOpenCodeCodingPlanOpenAI = createOpenAICompatibleRuntime({
  provider: ModelProvider.OpenCodeCodingPlan,
  baseURL: GO_BASE_URL,
  chatCompletion: { handlePayload: buildOpenAIPayload },
  debug: {
    chatCompletion: () => process.env.DEBUG_OPENCODE_GO_CHAT_COMPLETION === '1',
  },
});

// Anthropic SDK auto-appends /v1/messages to baseURL, so strip trailing /v1
const stripV1 = (url?: string) => url?.replace(/\/v1$/, '');

// ============================================================================
// Provider Export
// ============================================================================

export const params = {
  debug: {
    chatCompletion: () => process.env.DEBUG_OPENCODE_GO_CHAT_COMPLETION === '1',
  },
  id: ModelProvider.OpenCodeCodingPlan,
  models: async ({ client }) => {
    try {
      // 1. Try API first (real-time available models)
      const modelsPage = await (client as any).models.list();
      const apiModels = modelsPage.data || [];
      return processMultiProviderModelList(apiModels, 'opencodecodingplan');
    } catch {
      // 2. Fallback to models.dev + model-bank
      const { modelsDev } = await fetchModelsDevData();
      const modelIds = Object.keys(modelsDev);

      if (modelIds.length > 0) {
        return processMultiProviderModelList(
          modelIds.map((id) => ({ id })),
          'opencodecodingplan',
        );
      }

      // 3. Final fallback: static model bank
      const { opencodecodingplan } = await import('model-bank');
      return processMultiProviderModelList(
        opencodecodingplan.map((m) => ({ id: m.id })),
        'opencodecodingplan',
      );
    }
  },
  routers: async (options) => {
    const baseURL = options.baseURL || GO_BASE_URL;

    const anthropicModels = await getAnthropicModels();

    return [
      // Anthropic SDK for models with provider.npm === '@ai-sdk/anthropic'
      {
        apiType: 'anthropic',
        models: anthropicModels,
        options: { ...options, baseURL: stripV1(baseURL) },
      },
      // OpenAI-compatible fallback for all other models
      {
        apiType: 'openai',
        runtime: LobeOpenCodeCodingPlanOpenAI as any,
        options: { ...options, baseURL },
      },
    ];
  },
} satisfies CreateRouterRuntimeOptions;

export const LobeOpenCodeCodingPlanAI = createRouterRuntime(params);
