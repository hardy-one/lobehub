import { LOBE_DEFAULT_MODEL_LIST, ModelProvider } from 'model-bank';

import { responsesAPIModels } from '../../const/models';
import { createRouterRuntime } from '../../core/RouterRuntime';
import type { CreateRouterRuntimeOptions } from '../../core/RouterRuntime/createRuntime';
import { detectModelProvider, processMultiProviderModelList } from '../../utils/modelParse';

const ZEN_BASE_URL = 'https://opencode.ai/zen/v1';

// Claude models use @ai-sdk/anthropic via Zen Gateway
const claudeModels = LOBE_DEFAULT_MODEL_LIST.map((m) => m.id).filter(
  (id) => detectModelProvider(id) === 'anthropic',
);

// Gemini models use @ai-sdk/google via Zen Gateway
const geminiModels = LOBE_DEFAULT_MODEL_LIST.map((m) => m.id).filter(
  (id) => detectModelProvider(id) === 'google',
);

// GPT-5.x models use @ai-sdk/openai (Responses API) via Zen Gateway
const gptModels = LOBE_DEFAULT_MODEL_LIST.map((m) => m.id).filter(
  (id) => detectModelProvider(id) === 'openai',
);

export const params = {
  debug: {
    chatCompletion: () => process.env.DEBUG_OPENCODE_ZEN_CHAT_COMPLETION === '1',
  },
  id: ModelProvider.OpenCodeZen,
  models: async ({ client: openAIClient }) => {
    const modelsPage = (await openAIClient.models.list()) as any;
    const modelList = modelsPage.data || [];
    return processMultiProviderModelList(modelList, 'opencodezen');
  },
  routers: (options) => {
    return [
      // Anthropic router for Claude models
      {
        apiType: 'anthropic',
        models: claudeModels,
        options: {
          ...options,
          baseURL: options.baseURL || ZEN_BASE_URL,
        },
      },
      // Google router for Gemini models
      {
        apiType: 'google',
        models: geminiModels,
        options: {
          ...options,
          baseURL: options.baseURL || ZEN_BASE_URL,
        },
      },
      // OpenAI router for GPT-5.x models (Responses API)
      {
        apiType: 'openai',
        models: gptModels,
        options: {
          ...options,
          baseURL: options.baseURL || ZEN_BASE_URL,
          chatCompletion: {
            useResponseModels: [...Array.from(responsesAPIModels), /gpt-\d(?!\d)/, /^o\d/],
          },
        },
      },
      // OpenAI-compatible fallback for all other models (GLM, Kimi, MiniMax, Qwen, etc.)
      {
        apiType: 'openai',
        options: {
          ...options,
          baseURL: options.baseURL || ZEN_BASE_URL,
        },
      },
    ];
  },
} satisfies CreateRouterRuntimeOptions;

export const LobeOpenCodeZenAI = createRouterRuntime(params);
