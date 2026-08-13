import type { ModelScopedChatConfigs } from '@lobechat/types';

/**
 * Build the `modelConfigs` patch that scopes `useModelBuiltinSearch` to a
 * single provider/model pair. Shared by the ChatInput search-mode dropdown
 * (Plus ActionBar) and the ModelBuiltinSearch toggle to keep the patch
 * construction in one place.
 *
 * @param provider - The provider id
 * @param model - The model id
 * @param useModelBuiltinSearch - Whether the model's builtin search should be used
 */
export const buildModelConfigsPatch = (
  provider: string,
  model: string,
  useModelBuiltinSearch: boolean,
): { modelConfigs: ModelScopedChatConfigs } => ({
  modelConfigs: { [provider]: { [model]: { useModelBuiltinSearch } } },
});
