import type { ModelSdkType } from 'model-bank';

import { getCachedModelsDevRoutingMetadata } from '../providers/utils/modelsDev';

export interface ModelSdkRoutingOptions {
  /** Exact user/model settings, supplied by the scoped model catalog. */
  modelSdkOverrides?: Record<string, ModelSdkType>;
  modelSdkTypes?: Record<string, ModelSdkType>;
  /** Explicit provider-wide protocol, not a inferred provider default. */
  providerSdkType?: ModelSdkType;
}

/** Resolve within one provider only; model names are not global protocol declarations. */
export const resolveModelSdkType = ({
  bankModels,
  model,
  modelsDevProvider,
  options,
}: {
  bankModels: ReadonlyArray<{ id: string; sdkType?: ModelSdkType }>;
  model?: string;
  modelsDevProvider: string;
  options: ModelSdkRoutingOptions;
}): ModelSdkType | undefined => {
  if (!model) return options.providerSdkType;
  const override = options.modelSdkOverrides?.[model];
  if (override) return override;
  if (options.providerSdkType) return options.providerSdkType;
  const configured = options.modelSdkTypes?.[model];
  if (configured) return configured;
  const { modelIdsBySdk } = getCachedModelsDevRoutingMetadata(modelsDevProvider);
  if (modelIdsBySdk['@ai-sdk/anthropic']?.includes(model)) return 'anthropic';
  if (modelIdsBySdk['@ai-sdk/google']?.includes(model)) return 'google';
  if (modelIdsBySdk['@ai-sdk/openai']?.includes(model)) return 'openai-responses';
  if (modelIdsBySdk['@ai-sdk/openai-compatible']?.includes(model)) return 'openai';
  return bankModels.find((card) => card.id === model)?.sdkType;
};
