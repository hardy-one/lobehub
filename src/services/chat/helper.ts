import type { EnabledAiModel } from 'model-bank';
import { ModelProvider } from 'model-bank/modelProvider';

import { getAiInfraStoreState } from '@/store/aiInfra';
import { aiProviderSelectors } from '@/store/aiInfra/selectors';

export const getEnabledRuntimeModel = (
  model: string,
  provider: string,
): EnabledAiModel | undefined => {
  const state = getAiInfraStoreState();
  const exactModel = state.enabledAiModels?.find(
    (item) => item.id === model && item.providerId === provider,
  );

  if (exactModel || provider !== ModelProvider.LobeHub) return exactModel;

  return state.enabledAiModels?.find((item) => item.id === model);
};

const getModelAbilities = (model: string, provider: string) => {
  return getEnabledRuntimeModel(model, provider)?.abilities;
};

export const isCanUseVision = (model: string, provider: string): boolean => {
  return getModelAbilities(model, provider)?.vision || false;
};

export const isCanUseVideo = (model: string, provider: string): boolean => {
  return getModelAbilities(model, provider)?.video || false;
};

export const isCanUseAudio = (model: string, provider: string): boolean => {
  return getModelAbilities(model, provider)?.audio || false;
};

export const getRuntimeModelKnowledgeCutoff = (
  model: string,
  provider: string,
): string | undefined => getEnabledRuntimeModel(model, provider)?.knowledgeCutoff;

export const getRuntimeModelDisplayName = (model: string, provider: string): string | undefined =>
  getEnabledRuntimeModel(model, provider)?.displayName;

/**
 * TODO: we need to update this function to auto find deploymentName with provider setting config
 */
export const findDeploymentName = (model: string, provider: string) => {
  let deploymentId = model;

  // find the model by id
  const modelItem = getAiInfraStoreState().enabledAiModels?.find(
    (i) => i.id === model && i.providerId === provider,
  );

  if (modelItem && modelItem.config?.deploymentName) {
    deploymentId = modelItem.config?.deploymentName;
  }

  return deploymentId;
};

export const isEnableFetchOnClient = (provider: string) => {
  return aiProviderSelectors.isProviderFetchOnClient(provider)(getAiInfraStoreState());
};

export const resolveRuntimeProvider = (provider: string) => {
  const isBuiltin = Object.values(ModelProvider).includes(provider as any);
  if (isBuiltin) return provider;

  const providerConfig = aiProviderSelectors.providerConfigById(provider)(getAiInfraStoreState());

  return providerConfig?.settings.sdkType || 'openai';
};

/**
 * Whether the UA identifies a native LobeHub mobile app client (iOS/Android
 * app shells, legacy iOS UAs, Android okhttp). Mirrors the server-side
 * `isMobileClient` (@lobechat/utils/server) so the direct-chat path applies
 * the same rule: mobile apps render fragments natively, so the HTML-render
 * marker protocol must not be advertised to them.
 */
const MOBILE_CLIENT_UA_PATTERN =
  /\bLobeHub-Mobile\/(?:android|ios)-v\S+|\bLobeHub-iOS\/|\bLobeHub\/\S+\s+CFNetwork\/|\bokhttp\//i;

export const isMobileClientUA = (userAgent: string | undefined): boolean =>
  typeof userAgent === 'string' && MOBILE_CLIENT_UA_PATTERN.test(userAgent);
