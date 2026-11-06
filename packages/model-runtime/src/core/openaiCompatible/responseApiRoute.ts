import { isResponsesAPIModel } from '../../providers/openai/modelId';

export interface ShouldUseResponsesAPIParams {
  /** Context for logging (e.g., 'chat', 'generateObject', 'tool calling') */
  context?: string;
  /** Factory/instance level useResponse flag */
  flagUseResponse?: boolean;
  /** Factory/instance level model patterns for Responses API */
  flagUseResponseModels?: Array<string | RegExp>;
  /** The model ID to check */
  model?: string;
  /** Explicit responseApi flag */
  responseApi?: boolean;
  /** User-specified API mode (highest priority) */
  userApiMode?: string;
}

export interface ShouldUseResponsesAPIDeps {
  log?: (message: string, ...args: unknown[]) => void;
  /** Provider-scoped protocol metadata, when the provider names one per model. */
  modelSdkType?: 'openai' | 'openai-responses';
}

/**
 * Which endpoint a request takes: the Responses API or Chat Completions.
 *
 * Provider-scoped protocol metadata wins over everything, then the model's own name — a model
 * that only answers on the Responses contract must go there whatever the user chose — then the
 * user's switch, then the factory's flags.
 */
export const shouldUseResponsesAPI = (
  params: ShouldUseResponsesAPIParams,
  deps: ShouldUseResponsesAPIDeps = {},
): boolean => {
  const {
    model,
    userApiMode,
    responseApi,
    flagUseResponse,
    flagUseResponseModels,
    context = 'operation',
  } = params;
  const { log = () => {}, modelSdkType } = deps;

  if (modelSdkType) {
    return modelSdkType === 'openai-responses';
  }

  // Priority 0: Check built-in Responses API model rules FIRST (highest priority)
  // These models MUST use Responses API regardless of user settings.
  if (model && isResponsesAPIModel(model)) {
    log('using Responses API: model %s matches built-in Responses API model rules', model);
    return true;
  }

  // Priority 1: userApiMode is explicitly set to 'chatCompletion' (user disabled the switch)
  if (userApiMode === 'chatCompletion') {
    log('using Chat Completions API: userApiMode=%s', userApiMode);
    return false;
  }

  // Priority 2: When user enables the switch (userApiMode === 'responses')
  // Check if useResponseModels is configured - if so, only matching models use Responses API
  // If useResponseModels is not configured, all models use Responses API
  if (userApiMode === 'responses') {
    if (model && flagUseResponseModels?.length) {
      const matches = flagUseResponseModels.some((m: string | RegExp) =>
        typeof m === 'string' ? model.includes(m) : (m as RegExp).test(model),
      );
      if (matches) {
        log(
          'using Responses API: userApiMode=responses and model %s matches useResponseModels',
          model,
        );
        return true;
      }
      log(
        'using Chat Completions API: userApiMode=responses but model %s does not match useResponseModels',
        model,
      );
      return false;
    }
    // No useResponseModels configured, use Responses API for all models
    log('using Responses API: userApiMode=responses (no useResponseModels filter)');
    return true;
  }

  // Priority 3: Explicit responseApi flag
  if (responseApi) {
    log('using Responses API: explicit responseApi flag for %s', context);
    return true;
  }

  // Priority 4: Factory/instance level useResponse flag
  if (flagUseResponse) {
    log('using Responses API: flagUseResponse=true for %s', context);
    return true;
  }

  // Priority 5: Check if model matches useResponseModels patterns (without user switch)
  if (model && flagUseResponseModels?.length) {
    const matches = flagUseResponseModels.some((m: string | RegExp) =>
      typeof m === 'string' ? model.includes(m) : (m as RegExp).test(model),
    );
    if (matches) {
      log('using Responses API: model %s matches useResponseModels config', model);
      return true;
    }
  }

  log('using Chat Completions API for %s', context);
  return false;
};

/**
 * The user's Responses API preference for a call that carries no `apiMode` of its own.
 *
 * A chat payload always names its mode (`services/chat` in the browser, `ServerLLMTransport` on
 * a gateway run), but structured output is requested by dozens of server callers that build
 * their payload themselves, so the runtime holds the provider's answer instead of asking every
 * caller to repeat it. `undefined` keeps the model-name default.
 */
export const resolveUserApiMode = (
  payloadApiMode?: string,
  providerApiMode?: 'chatCompletion' | 'responses',
) => payloadApiMode ?? providerApiMode;
