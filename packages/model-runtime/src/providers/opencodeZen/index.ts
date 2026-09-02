import { LOBE_DEFAULT_MODEL_LIST, ModelProvider, opencodezen } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { createRouterRuntime } from '../../core/RouterRuntime';
import type { CreateRouterRuntimeOptions } from '../../core/RouterRuntime/createRuntime';
import { detectModelProvider } from '../../utils/modelParse';
import { resolveModelSdkType } from '../../utils/modelSdkRouting';
import { responsesAPIModels } from '../openai/modelId';
import { getCachedModelsDevRoutingMetadata, resolveModelsDevModelList } from '../utils/modelsDev';
import { resolveProviderRouteModels } from '../utils/resolveProviderRouteModels';

// ============================================================================
// Constants
// ============================================================================

const ZEN_BASE_URL = 'https://opencode.ai/zen/v1';
const ZenOpenAI = createOpenAICompatibleRuntime({
  provider: ModelProvider.OpenCodeZen,
  baseURL: ZEN_BASE_URL,
});

// Anthropic SDK auto-appends /v1/messages to baseURL, so strip trailing /v1
const stripV1 = (url?: string) => url?.replace(/\/v1$/, '');

// Legacy provider-local fallback; precise protocol metadata always wins.
const fallbackAnthropicModels = opencodezen
  .filter(
    (model) =>
      model.sdkType === 'anthropic' ||
      (!model.sdkType && detectModelProvider(model.id) === 'anthropic'),
  )
  .map((model) => model.id);
const fallbackGoogleModels = opencodezen
  .filter(
    (model) =>
      model.sdkType === 'google' || (!model.sdkType && detectModelProvider(model.id) === 'google'),
  )
  .map((model) => model.id);
const fallbackResponseModels = opencodezen
  .filter(
    (model) =>
      model.sdkType === 'openai-responses' ||
      (!model.sdkType && detectModelProvider(model.id) === 'openai'),
  )
  .map((model) => model.id);

// ============================================================================
// Provider Export
// ============================================================================

export const params = {
  debug: {
    chatCompletion: () => process.env.DEBUG_OPENCODE_ZEN_CHAT_COMPLETION === '1',
  },
  id: ModelProvider.OpenCodeZen,
  models: async ({ client }) => {
    const { opencodezen } = await import('model-bank');
    return resolveModelsDevModelList({
      bankModels: opencodezen,
      client,
      modelsDevProvider: 'opencode',
      providerId: 'opencodezen',
    });
  },
  routers: (options, runtimeContext?: { model?: string }) => {
    const baseURL = options.baseURL || ZEN_BASE_URL;
    const { available, modelIdsBySdk } = getCachedModelsDevRoutingMetadata('opencode');
    const sdkType = resolveModelSdkType({
      bankModels: opencodezen,
      model: runtimeContext?.model,
      modelsDevProvider: 'opencode',
      options: {
        modelSdkOverrides: options.modelSdkOverrides,
        modelSdkTypes: options.modelSdkTypes,
        providerSdkType: options.providerSdkType,
      },
    });
    const forSdk = (sdk: typeof sdkType, cached: string[], fallback: string[]) => {
      const defaults = available ? cached : fallback;
      if (!runtimeContext?.model || !sdkType) return defaults;
      return [
        ...defaults.filter((id) => id !== runtimeContext.model),
        ...(sdkType === sdk ? [runtimeContext.model] : []),
      ];
    };
    const anthropicModels = forSdk(
      'anthropic',
      modelIdsBySdk['@ai-sdk/anthropic'] ?? [],
      fallbackAnthropicModels,
    );
    const googleModels = forSdk(
      'google',
      modelIdsBySdk['@ai-sdk/google'] ?? [],
      fallbackGoogleModels,
    );
    const responseModels = forSdk(
      'openai-responses',
      modelIdsBySdk['@ai-sdk/openai'] ?? [],
      fallbackResponseModels,
    );

    return [
      {
        apiType: 'anthropic',
        models: anthropicModels,
        options: {
          ...options,
          baseURL: stripV1(baseURL),
        },
      },
      {
        apiType: 'google',
        models: googleModels,
        options: {
          ...options,
          baseURL,
        },
      },
      {
        apiType: 'openai',
        models: responseModels,
        runtime: ZenOpenAI as any,
        options: {
          ...options,
          baseURL,
          modelSdkType: 'openai-responses',
          chatCompletion: {
            useResponseModels: sdkType
              ? responseModels
              : available
                ? responseModels
                : [...Array.from(responsesAPIModels), /gpt-\d(?!\d)/, /^o\d/],
          },
        },
      },
      {
        apiType: 'deepseek',
        models: resolveProviderRouteModels(
          'deepseek',
          LOBE_DEFAULT_MODEL_LIST,
          runtimeContext?.model,
        ),
        options: {
          ...options,
          baseURL,
          sdkType: 'openai',
        },
      },
      // OpenAI-compatible fallback for all other models.
      {
        apiType: 'openai',
        runtime: ZenOpenAI as any,
        options: {
          ...options,
          baseURL,
          modelSdkType: sdkType === 'openai' ? 'openai' : undefined,
        },
      },
    ];
  },
} satisfies CreateRouterRuntimeOptions;

export const LobeOpenCodeZenAI = createRouterRuntime(params);
