import { ModelProvider } from 'model-bank';

import { createRouterRuntime } from '../../core/RouterRuntime';
import type { CreateRouterRuntimeOptions } from '../../core/RouterRuntime/createRuntime';
import { processMultiProviderModelList } from '../../utils/modelParse';

const GO_BASE_URL = 'https://opencode.ai/zen/go/v1';

// MiniMax models in Go use @ai-sdk/anthropic (Anthropic Messages API format)
// Endpoint: /go/v1/messages
const minimaxModels = ['minimax-m2.5', 'minimax-m2.7'];

// Qwen models in Go use @ai-sdk/alibaba which is not in our apiTypes.
// They fall through to openai-compatible. The Gateway handles format conversion.
// All other models (GLM, Kimi, MiMo) use @ai-sdk/openai-compatible.

export const params = {
  debug: {
    chatCompletion: () => process.env.DEBUG_OPENCODE_GO_CHAT_COMPLETION === '1',
  },
  id: ModelProvider.OpenCodeGo,
  models: async () => {
    const { opencodego } = await import('model-bank');
    return processMultiProviderModelList(
      opencodego.map((m: { id: string }) => ({ id: m.id })),
      'opencodego',
    );
  },
  routers: (options) => {
    return [
      // Anthropic router for MiniMax models (use Anthropic Messages API format)
      {
        apiType: 'anthropic',
        models: minimaxModels,
        options: {
          ...options,
          baseURL: options.baseURL || GO_BASE_URL,
        },
      },
      // OpenAI-compatible fallback for all other models (GLM, Kimi, MiMo, Qwen)
      {
        apiType: 'openai',
        options: {
          ...options,
          baseURL: options.baseURL || GO_BASE_URL,
        },
      },
    ];
  },
} satisfies CreateRouterRuntimeOptions;

export const LobeOpenCodeGoAI = createRouterRuntime(params);
