import { aiProviderSelectors } from '@/store/aiInfra/selectors';
import { getAiInfraStoreState } from '@/store/aiInfra/store';

import { createPayloadWithKeyVaults } from '../../_auth';

export interface InitializeWithClientStoreOptions {
  payload?: any;
  provider: string;
  runtimeProvider?: string;
}

/**
 * Initializes the AgentRuntime with the client store.
 * @param options.provider - Provider identifier used to resolve key vaults.
 * @param options.runtimeProvider - Actual runtime implementation key (defaults to provider).
 * @param options.payload - Additional initialization payload.
 * @returns The initialized AgentRuntime instance
 *
 * **Note**: if you try to fetch directly, use `fetchOnClient` instead.
 */
export const initializeWithClientStore = async ({
  provider,
  runtimeProvider,
  payload,
}: InitializeWithClientStoreOptions) => {
  const { ModelRuntime } = await import('@lobechat/model-runtime');

  /**
   * Since #5267, we map parameters for client-fetch in function `getProviderAuthPayload`
   * which called by `createPayloadWithKeyVaults` below.
   * @see https://github.com/lobehub/lobe-chat/pull/5267
   * @file src/services/_auth.ts
   */
  const providerAuthPayload = { ...payload, ...createPayloadWithKeyVaults(provider) };
  /**
   * The provider's “使用 Responses API 规范” switch, for the structured-output calls that build
   * their own payload (`generateObject` has no `apiMode` field from its callers). An unset
   * switch stays unset here: dropping in the `openai` default would move every model of every
   * provider onto the Responses endpoint, which only an explicit choice should do.
   */
  const enableResponseApi =
    aiProviderSelectors.providerConfigById(provider)(getAiInfraStoreState())?.config
      ?.enableResponseApi;
  const responseApiMode =
    typeof enableResponseApi === 'boolean'
      ? enableResponseApi
        ? ('responses' as const)
        : ('chatCompletion' as const)
      : undefined;
  // Providers whose models speak different protocols route per model, so both the
  // provider-sourced sdk type and the explicit user override travel with the client.
  const routingOptions: Record<string, unknown> = {};
  if (provider === 'opencodecodingplan') {
    const state = getAiInfraStoreState();
    const models = state.enabledAiModels?.filter((item) => item.providerId === provider) ?? [];
    routingOptions.modelSdkTypes = Object.fromEntries(
      models.filter((m) => m.sdkType).map((m) => [m.id, m.sdkType]),
    );
    routingOptions.modelSdkOverrides = Object.fromEntries(
      models.filter((m) => m.config?.sdkType).map((m) => [m.id, m.config!.sdkType]),
    );
  }
  const commonOptions = {
    // Allow OpenAI SDK and Anthropic SDK run on browser
    dangerouslyAllowBrowser: true,
  };
  /**
   * Configuration override order:
   * payload -> providerAuthPayload -> commonOptions
   */
  return ModelRuntime.initializeWithProvider(runtimeProvider ?? provider, {
    ...commonOptions,
    ...providerAuthPayload,
    ...(responseApiMode && { responseApiMode }),
    ...payload,
    providerId: provider,
    ...routingOptions,
  });
};
