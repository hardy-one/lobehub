import { pickNonEmptyString } from '@lobechat/utils/object';
import type { ModelSdkType } from 'model-bank';
import { ModelProvider, opencodecodingplan } from 'model-bank';
import type OpenAI from 'openai';

import {
  buildDefaultAnthropicPayload,
  createAnthropicCompatibleRuntime,
} from '../../core/anthropicCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { createRouterRuntime } from '../../core/RouterRuntime';
import type { CreateRouterRuntimeOptions } from '../../core/RouterRuntime/createRuntime';
import type {
  ChatMethodOptions,
  ChatStreamPayload,
  GenerateObjectOptions,
  GenerateObjectPayload,
} from '../../types';
import { resolveModelSdkType } from '../../utils/modelSdkRouting';
import {
  isKimiNativeThinkingModel,
  isKimiReasoningEffortModel,
  isKimiReasoningModel,
} from '../moonshot/modelId';
import {
  getCachedModelsDevProvider,
  getCachedModelsDevRoutingMetadata,
  resolveModelsDevModelList,
} from '../utils/modelsDev';

// ============================================================================
// Constants
// ============================================================================

const GO_BASE_URL = 'https://opencode.ai/zen/go/v1';

/** models.dev `provider.npm` → the OpenCode Go route that must serve the model. */
const MODELS_DEV_NPM_BY_SDK = {
  'anthropic': '@ai-sdk/anthropic',
  'google': '@ai-sdk/google',
  'openai-responses': '@ai-sdk/openai',
} as const satisfies Partial<Record<ModelSdkType, string>>;

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

let cachedInterleavedIds: ReadonlySet<string> = FALLBACK_INTERLEAVED_IDS;

interface OpenCodeGoRouting {
  anthropic: string[];
  google: string[];
  openaiResponses: string[];
}

/**
 * Model ids per SDK route. The in-repo bank is authoritative for models it knows
 * (`sdkType` is synced from models.dev at catalog build time), and models.dev adds
 * ids the bank has not caught up with yet. Each id lands in exactly one route.
 */
const resolveOpenCodeGoRouting = (): OpenCodeGoRouting => {
  const metadata = getCachedModelsDevRoutingMetadata('opencode-go');
  if (metadata.interleavedModelIds.size > 0) cachedInterleavedIds = metadata.interleavedModelIds;

  const fromBank: Record<ModelSdkType, string[]> = {
    'anthropic': [],
    'google': [],
    'openai': [],
    'openai-responses': [],
  };
  for (const model of opencodecodingplan) {
    if (model.sdkType) fromBank[model.sdkType].push(model.id);
  }

  const claimed = new Set(Object.values(fromBank).flat());
  const fromModelsDev = (sdk: keyof typeof MODELS_DEV_NPM_BY_SDK) =>
    (metadata.modelIdsBySdk[MODELS_DEV_NPM_BY_SDK[sdk]] ?? []).filter((id) => !claimed.has(id));

  return {
    anthropic: [...fromBank.anthropic, ...fromModelsDev('anthropic')],
    google: [...fromBank.google, ...fromModelsDev('google')],
    openaiResponses: [...fromBank['openai-responses'], ...fromModelsDev('openai-responses')],
  };
};

/** Sync accessor for the interleaved model set, refreshed by route resolution. */
const getInterleavedModelIds = (): ReadonlySet<string> => cachedInterleavedIds;

const getModelsDevProviderModels = () => {
  const modelsById = new Map(
    opencodecodingplan.map((model) => [model.id, { id: model.id, maxOutput: model.maxOutput }]),
  );

  // models.dev enrichment is populated by the model-fetch path. Prefer its
  // current value when available, while keeping model-bank metadata usable on
  // a cold cache.
  for (const model of Object.values(getCachedModelsDevProvider('opencode-go'))) {
    if (model.limit?.output === undefined) continue;
    modelsById.set(model.id, { id: model.id, maxOutput: model.limit.output });
  }

  return [...modelsById.values()];
};

/**
 * Output limit for a model: the models.dev value fetched by the model-list path
 * wins, falling back to the static model-bank card so a cold cache still gets a
 * limit on the first request.
 */
const getModelMaxOutput = (model?: string): number | undefined => {
  if (!model) return undefined;

  return (
    getCachedModelsDevProvider('opencode-go')[model]?.limit?.output ??
    opencodecodingplan.find((item) => item.id === model)?.maxOutput
  );
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
// The set is populated while resolving routes (models.dev metadata); the fallback
// is used before route resolution or when models.dev is unavailable.
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
// Payload Builders
// ============================================================================

interface PayloadFlags {
  interleaved: boolean;
  isKimi: boolean;
  maxTokens?: number;
  nativeThinking: boolean;
  shouldForceReasoning: boolean;
  thinkingExplicitlyDisabled: boolean;
}

const resolvePayloadFlags = (payload: ChatStreamPayload): PayloadFlags => {
  const model = payload.model;
  const isKimi = isKimiThinkingToggleModel(model);
  const interleaved = isInterleavedModel(model);

  // Native-thinking Kimi models (k2.7-code, k3+) cannot turn reasoning off, so a
  // saved disabled-thinking setting is ignored: they still require the
  // reasoning_content round-trip.
  const nativeThinking = isKimiNativeThinkingModel(model);
  const thinkingExplicitlyDisabled = !nativeThinking && payload.thinking?.type === 'disabled';

  return {
    interleaved,
    isKimi,
    maxTokens: payload.max_tokens ?? getModelMaxOutput(model),
    nativeThinking,
    shouldForceReasoning: (interleaved || isKimi) && !thinkingExplicitlyDisabled,
    thinkingExplicitlyDisabled,
  };
};

/**
 * Attach the historical thinking content the gateway expects back. Only the
 * interleaved / Kimi families exchange the structured `reasoning` block for the
 * flat `reasoning_content` field; every other model keeps `reasoning` untouched
 * so the Responses converter can replay its reasoning items.
 */
const normalizeReasoningMessages = (messages: any[], flags: PayloadFlags) => {
  const { interleaved, isKimi, shouldForceReasoning } = flags;
  if (!isKimi && !interleaved) return messages;

  return messages.map((message: any) => {
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
};

// Kimi models reject nullable enums in both response_format and tool parameters.
const sanitizeKimiResponseFormat = (response_format: any, isKimi: boolean) =>
  isKimi &&
  response_format &&
  'json_schema' in response_format &&
  response_format.json_schema?.schema
    ? {
        ...response_format,
        json_schema: {
          ...response_format.json_schema,
          schema: sanitizeJsonSchema(response_format.json_schema.schema),
        },
      }
    : response_format;

const sanitizeKimiTools = (tools: any, isKimi: boolean) =>
  isKimi && tools
    ? tools.map((tool: any) => ({
        ...tool,
        function: {
          ...tool.function,
          parameters: tool.function?.parameters
            ? sanitizeJsonSchema(tool.function.parameters)
            : tool.function?.parameters,
        },
      }))
    : tools;

// Kimi K3+ only accepts reasoning_effort 'max' (also the server default) — drop
// any other saved effort instead of sending a value the API rejects.
const resolveReasoningEffort = (model: string, payload: ChatStreamPayload, flags: PayloadFlags) => {
  const reasoning_effort = payload.reasoning_effort;
  if (!reasoning_effort || flags.thinkingExplicitlyDisabled) return undefined;
  if (isKimiReasoningEffortModel(model) && reasoning_effort !== 'max') return undefined;
  return reasoning_effort;
};

/**
 * Chat Completions payload. Adds the K2.x-only `thinking` switch, sanitizes the
 * schemas the gateway rejects, and tops up `max_tokens` from the model limit.
 */
export const buildOpenAIPayload = (
  payload: ChatStreamPayload,
): OpenAI.ChatCompletionCreateParamsStreaming => {
  const flags = resolvePayloadFlags(payload);
  const { reasoning_effort: _reasoning_effort, thinking, ...restPayload } = payload;

  return {
    ...restPayload,
    messages: normalizeReasoningMessages(restPayload.messages, flags),
    response_format: sanitizeKimiResponseFormat(restPayload.response_format, flags.isKimi),
    tools: sanitizeKimiTools(restPayload.tools, flags.isKimi),
    ...(flags.maxTokens === undefined ? {} : { max_tokens: flags.maxTokens }),
    ...(resolveReasoningEffort(payload.model, payload, flags) !== undefined
      ? { reasoning_effort: payload.reasoning_effort }
      : {}),
    // K3+ models configure reasoning via top-level reasoning_effort only and
    // reject the K2.x-only `thinking` param; native-thinking models never get
    // `disabled` re-emitted (the toggle does not exist for them).
    ...(!isKimiReasoningEffortModel(payload.model) &&
    (thinking?.type === 'enabled' || (thinking?.type === 'disabled' && !flags.nativeThinking))
      ? { thinking: { type: thinking.type } }
      : {}),
    stream: payload.stream ?? true,
  } as OpenAI.ChatCompletionCreateParamsStreaming;
};

/**
 * Responses payload. The Responses endpoint reads `reasoning.effort` and rejects
 * the Chat Completions–only `thinking` switch, so that switch is dropped here.
 */
export const buildResponsesPayload = (payload: ChatStreamPayload): ChatStreamPayload => {
  const flags = resolvePayloadFlags(payload);
  const { reasoning_effort: _reasoning_effort, thinking: _thinking, ...restPayload } = payload;

  const reasoning_effort = resolveReasoningEffort(payload.model, payload, flags);

  return {
    ...restPayload,
    messages: normalizeReasoningMessages(restPayload.messages, flags),
    response_format: sanitizeKimiResponseFormat(restPayload.response_format, flags.isKimi),
    tools: sanitizeKimiTools(restPayload.tools, flags.isKimi),
    ...(flags.maxTokens === undefined ? {} : { max_tokens: flags.maxTokens }),
    ...(reasoning_effort === undefined ? {} : { reasoning_effort }),
    stream: payload.stream ?? true,
  };
};

// ============================================================================
// Runtime Instances
// ============================================================================

// OpenAI-compatible runtime: Responses for `@ai-sdk/openai` models, Chat
// Completions for the openai-compatible remainder.
const LobeOpenCodeCodingPlanOpenAI = createOpenAICompatibleRuntime({
  provider: ModelProvider.OpenCodeCodingPlan,
  baseURL: GO_BASE_URL,
  chatCompletion: { handlePayload: buildOpenAIPayload },
  debug: {
    chatCompletion: () => process.env.DEBUG_OPENCODE_GO_CHAT_COMPLETION === '1',
    responses: () => process.env.DEBUG_OPENCODE_GO_CHAT_COMPLETION === '1',
  },
  responses: { handlePayload: buildResponsesPayload },
});

// Anthropic SDK auto-appends /v1/messages to baseURL, so strip trailing /v1
const stripV1 = (url?: string) => url?.replace(/\/v1$/, '');

export const buildOpenCodeAnthropicPayload = (payload: ChatStreamPayload) =>
  buildDefaultAnthropicPayload(payload, { providerModels: getModelsDevProviderModels() });

const LobeOpenCodeCodingPlanAnthropic = createAnthropicCompatibleRuntime({
  provider: ModelProvider.OpenCodeCodingPlan,
  baseURL: stripV1(GO_BASE_URL),
  chatCompletion: { handlePayload: buildOpenCodeAnthropicPayload },
  debug: {
    chatCompletion: () => process.env.DEBUG_OPENCODE_GO_CHAT_COMPLETION === '1',
  },
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
    return resolveModelsDevModelList({
      bankModels: opencodecodingplan,
      client,
      modelsDevProvider: 'opencode-go',
      providerId: 'opencodecodingplan',
    });
  },
  routers: (options, runtimeContext?: { model?: string }) => {
    const baseURL = options.baseURL || GO_BASE_URL;
    const routing = resolveOpenCodeGoRouting();

    // A saved per-model protocol (settings.sdkType) or an explicit user override
    // (config.sdkType) wins over the provider metadata for the requested model.
    const sdkType = resolveModelSdkType({
      bankModels: opencodecodingplan,
      model: runtimeContext?.model,
      modelsDevProvider: 'opencode-go',
      options: {
        modelSdkOverrides: options.modelSdkOverrides,
        modelSdkTypes: options.modelSdkTypes,
        providerSdkType: options.providerSdkType,
      },
    });

    const requestedModel = runtimeContext?.model;
    // Move the requested model into the route its resolved protocol belongs to.
    const forSdk = (sdk: ModelSdkType, cached: string[]) => {
      if (!requestedModel || !sdkType) return cached;
      return [
        ...cached.filter((id) => id !== requestedModel),
        ...(sdkType === sdk ? [requestedModel] : []),
      ];
    };

    return [
      {
        apiType: 'anthropic',
        models: forSdk('anthropic', routing.anthropic),
        runtime: LobeOpenCodeCodingPlanAnthropic as any,
        options: { ...options, baseURL: stripV1(baseURL) },
      },
      {
        apiType: 'google',
        models: forSdk('google', routing.google),
        options: { ...options, baseURL },
      },
      {
        apiType: 'openai',
        models: forSdk('openai-responses', routing.openaiResponses),
        runtime: LobeOpenCodeCodingPlanOpenAI as any,
        options: { ...options, baseURL, modelSdkType: 'openai-responses' },
      },
      // Catch-all for the openai-compatible models that stay on Chat Completions.
      {
        apiType: 'openai',
        runtime: LobeOpenCodeCodingPlanOpenAI as any,
        options: { ...options, baseURL, modelSdkType: 'openai' },
      },
    ];
  },
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
    return super.chat(payload, {
      ...options,
      requestHeaders: {
        ...this.getSessionHeaders(options?.metadata),
        ...options?.requestHeaders,
      },
    });
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
