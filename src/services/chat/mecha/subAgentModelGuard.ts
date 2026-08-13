import { aiModelService } from '@/services/aiModel';
import { aiProviderSelectors, getAiInfraStoreState } from '@/store/aiInfra';

/**
 * Client-side mirror of the server's `isSubAgentModelEnabled`: whether a
 * `callSubAgent` override pair `(provider, model)` may run as a sub-agent.
 * Only pairs with EXPLICIT disable evidence are denied:
 *
 * 1. Provider not in the user's provider list (custom / user-typed provider) → allow (warn).
 * 2. Provider in the list but not enabled → deny.
 * 3. Model in the enabled chat models of an enabled provider → allow.
 * 4. Model has no `ai_models` row (user-typed model id) → allow (warn).
 * 5. Model has a row but `enabled === false` or `type !== 'chat'` → deny.
 *
 * `aiProviderSelectors.isProviderEnabled` returns `false` for ids missing from
 * the list, so unknown providers must be checked against the known provider
 * list FIRST — an unknown provider carries no disable evidence. Per-model
 * enablement is read from the server DB via `getAiProviderModelList` (same
 * source the model picker uses). Fail-closed only when the model list itself
 * cannot be fetched (error path — no evidence either way, deny conservatively).
 *
 * Server-side counterpart: `apps/server/src/utils/subAgentModelGuidance.ts`.
 * Semantics must stay in sync — update both files when changing the rules.
 */
export const isClientSubAgentModelEnabled = async (
  provider: string,
  model: string,
): Promise<boolean> => {
  const state = getAiInfraStoreState();

  // Rule 1: unknown provider — no disable evidence.
  const knownProviderIds = new Set(state.aiProviderList.map((item) => item.id));
  if (!knownProviderIds.has(provider)) {
    console.warn(
      `[subAgentModelGuard] Provider "${provider}" is not in the user's provider list; ` +
        `allowing sub-agent pair "${provider}/${model}" without validation.`,
    );
    return true;
  }

  // Rule 2: known provider explicitly disabled.
  if (!aiProviderSelectors.isProviderEnabled(provider)(state)) return false;

  try {
    const models = await aiModelService.getAiProviderModelList(provider);

    // Rule 4: no `ai_models` row for this model (user-typed model id).
    if (!models.some((item) => item.id === model)) {
      console.warn(
        `[subAgentModelGuard] Model "${model}" has no ai_models row under provider "${provider}"; ` +
          `allowing user-typed sub-agent pair.`,
      );
      return true;
    }

    // Rules 3 + 5: allow only an explicitly enabled chat row.
    return models.some(
      (item) => item.id === model && item.enabled === true && item.type === 'chat',
    );
  } catch {
    return false;
  }
};
