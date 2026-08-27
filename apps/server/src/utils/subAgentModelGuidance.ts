// Subpath import on purpose: the package root re-exports client executors that
// transitively pull locales/UI — too heavy for this util (and its tests).
import { LobeAgentApiName, LobeAgentIdentifier } from '@lobechat/builtin-tool-lobe-agent/types';
import type { LobeChatDatabase } from '@lobechat/database';

import { AiModelModel } from '@/database/models/aiModel';
import { AiProviderModel } from '@/database/models/aiProvider';

/**
 * Pure formatter for the callSubAgent model guidance injected into the
 * `lobe-agent.callSubAgent` tool schema (execAgent path) and appended to the
 * activation result (lobe-activator.activateTools path).
 *
 * The tool-schema placement is deliberate: it reaches the model under BOTH
 * prompt modes — `full` renders manifest systemRoles as teaching blocks, but
 * `lean` drops every manifest.systemRole entirely, so a former systemRole
 * append silently vanished for lean (效率) runs.
 *
 * The model list changes very infrequently, so it is resolved ONCE at
 * activation time (a rare event) and handed to the supervisor as part of the
 * activation result — no per-run DB queries, no per-run prompt rebuilding.
 *
 * Format groups models by provider — model ids repeat across providers, so
 * `"provider": {"model", ...}` is the unambiguous, compact shape. Only
 * enabled chat models are listed. Output is deterministic (providers sorted,
 * models sorted within each provider, caps applied after sorting) so repeated
 * activations produce identical text and provider-side prompt caches stay hit.
 *
 * Client-side mirror: `src/services/chat/mecha/subAgentModelGuard.ts`.
 * Semantics must stay in sync — update both files when changing the rules.
 */

export interface EnabledChatModelRow {
  enabled?: boolean | null;
  id: string;
  providerId: string;
  type?: string | null;
}

/** Cap on how many models are listed per provider. */
export const MAX_LISTED_MODELS_PER_PROVIDER = 30;

/**
 * Cap on the total number of models listed across all providers. Keeps the
 * injected description bounded for users with many enabled providers — past
 * this size the list stops helping the supervisor and starts costing tokens
 * on every request.
 */
export const MAX_LISTED_MODELS_TOTAL = 100;

/**
 * Format the guidance text. Deterministic: providers sorted alphabetically,
 * models sorted within each provider, per-provider cap applied first, then
 * the global total cap in sorted-provider order. When the global cap cut
 * anything, a trailing truncation note is appended.
 */
export const formatSubAgentModelGuidance = (models: EnabledChatModelRow[]): string | undefined => {
  const byProvider = new Map<string, string[]>();

  for (const model of models) {
    if (!model.enabled || model.type !== 'chat') continue;
    const ids = byProvider.get(model.providerId) ?? [];
    ids.push(model.id);
    byProvider.set(model.providerId, ids);
  }

  if (byProvider.size === 0) return undefined;

  let remaining = MAX_LISTED_MODELS_TOTAL;
  let totalCapped = false;
  const providerLines: string[] = [];

  for (const [provider, ids] of [...byProvider.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const sortedIds = [...ids].sort((a, b) => a.localeCompare(b));
    // Per-provider cap applies silently (pre-existing behavior); only the
    // global total cap gets an explicit truncation note.
    const cappedIds = sortedIds.slice(0, MAX_LISTED_MODELS_PER_PROVIDER);
    const take = Math.min(cappedIds.length, Math.max(remaining, 0));
    remaining -= take;
    if (take < cappedIds.length) totalCapped = true;
    if (take === 0) continue;
    providerLines.push(
      `"${provider}": {${cappedIds
        .slice(0, take)
        .map((id) => `"${id}"`)
        .join(', ')}}`,
    );
  }

  return [
    'callSubAgent valid models (model paired with its exact provider):',
    ...providerLines,
    ...(totalCapped ? [`(list truncated at ${MAX_LISTED_MODELS_TOTAL} models)`] : []),
  ].join('\n');
};

/** Short TTL: the enabled-model list changes rarely, but a stale guidance is worse than a fresh one. */
export const SUB_AGENT_MODEL_GUIDANCE_TTL_MS = 5 * 60 * 1000;

/**
 * Cached availability view of the user's sub-agent models. Shared by the
 * guidance formatter and the callSubAgent override validation so both always
 * agree.
 */
export interface SubAgentModelAvailability {
  /** Every `ai_models` row grouped by provider — a model id present here means the user has an explicit row for it. */
  allModelsByProvider: Map<string, Set<string>>;
  /** Chat models enabled under enabled providers (`ai_providers.enabled === true`). */
  enabledModelsByProvider: Map<string, Set<string>>;
  /** Provider ids the user has actually enabled (`ai_providers.enabled === true`). */
  providersEnabled: Set<string>;
  /** All provider ids present in `ai_providers` (enabled or not). Distinguishes "known but disabled" from "unknown" when validating pairs. */
  providersKnown: Set<string>;
}

const availabilityCache = new Map<
  string,
  { at: number; availability?: SubAgentModelAvailability }
>();

/**
 * Clear the availability cache. Exported for tests (and for any future
 * explicit invalidation, e.g. after provider/model settings change).
 */
export const clearSubAgentModelAvailabilityCache = () => {
  availabilityCache.clear();
};

/**
 * Resolve the user's sub-agent model availability, cached per
 * `userId:workspaceId` for a short TTL. Fail-open: any error means no
 * availability view (guidance omitted / override validation denied).
 */
const resolveSubAgentModelAvailability = async (
  serverDB: LobeChatDatabase,
  userId: string,
  workspaceId?: string,
): Promise<SubAgentModelAvailability | undefined> => {
  const key = `${userId}:${workspaceId ?? ''}`;
  const cached = availabilityCache.get(key);
  if (cached && Date.now() - cached.at < SUB_AGENT_MODEL_GUIDANCE_TTL_MS) {
    return cached.availability;
  }

  try {
    const [providers, models] = await Promise.all([
      new AiProviderModel(serverDB, userId, workspaceId).getAiProviderList(),
      new AiModelModel(serverDB, userId, workspaceId).getAllModels(),
    ]);

    const providersKnown = new Set(providers.map((provider) => provider.id));
    const providersEnabled = new Set(
      providers.filter((provider) => provider.enabled === true).map((provider) => provider.id),
    );

    const allModelsByProvider = new Map<string, Set<string>>();
    for (const model of models) {
      const ids = allModelsByProvider.get(model.providerId) ?? new Set<string>();
      ids.add(model.id);
      allModelsByProvider.set(model.providerId, ids);
    }

    const enabledModelsByProvider = new Map<string, Set<string>>();
    for (const model of models) {
      if (!model.enabled || model.type !== 'chat') continue;
      if (!providersEnabled.has(model.providerId)) continue;
      const ids = enabledModelsByProvider.get(model.providerId) ?? new Set<string>();
      ids.add(model.id);
      enabledModelsByProvider.set(model.providerId, ids);
    }

    const availability: SubAgentModelAvailability = {
      allModelsByProvider,
      enabledModelsByProvider,
      providersEnabled,
      providersKnown,
    };
    availabilityCache.set(key, { at: Date.now(), availability });
    return availability;
  } catch (error) {
    console.error('[subAgentModelGuidance] Failed to resolve available models:', error);
    return undefined;
  }
};

/**
 * Whether a `callSubAgent` override pair `(provider, model)` may run as a
 * sub-agent. Only pairs with EXPLICIT disable evidence are denied:
 *
 * 1. Provider not in `ai_providers` at all (custom / user-typed provider) → allow (warn).
 * 2. Provider in `ai_providers` but `enabled === false` → deny.
 * 3. Model in the enabled chat models of an enabled provider → allow.
 * 4. Model has no `ai_models` row (user-typed model id) → allow (warn).
 * 5. Model has a row but `enabled === false` or `type !== 'chat'` → deny.
 *
 * Fail-closed only when the availability view itself cannot be resolved
 * (error path — no evidence either way, deny conservatively).
 */
export const isSubAgentModelEnabled = async (
  serverDB: LobeChatDatabase,
  userId: string,
  workspaceId: string | undefined,
  provider: string,
  model: string,
): Promise<boolean> => {
  const availability = await resolveSubAgentModelAvailability(serverDB, userId, workspaceId);
  if (!availability) return false;

  const { allModelsByProvider, enabledModelsByProvider, providersEnabled, providersKnown } =
    availability;

  // Rule 1: unknown provider (no `ai_providers` row) — no disable evidence.
  if (!providersKnown.has(provider)) {
    console.warn(
      `[subAgentModelGuidance] Provider "${provider}" is not in the user's ai_providers list; ` +
        `allowing sub-agent pair "${provider}/${model}" without validation.`,
    );
    return true;
  }

  // Rule 2: known provider explicitly disabled.
  if (!providersEnabled.has(provider)) return false;

  // Rule 3: explicitly enabled chat model of an enabled provider.
  if (enabledModelsByProvider.get(provider)?.has(model)) return true;

  // Rule 4: no `ai_models` row for this model (user-typed model id).
  if (!allModelsByProvider.get(provider)?.has(model)) {
    console.warn(
      `[subAgentModelGuidance] Model "${model}" has no ai_models row under provider "${provider}"; ` +
        `allowing user-typed sub-agent pair.`,
    );
    return true;
  }

  // Rule 5: row exists but disabled or non-chat.
  return false;
};

/**
 * Resolve the callSubAgent model guidance for a user, cached per
 * `userId:workspaceId` for a short TTL. Used by the server-side
 * execAgent path (where `lobe-agent` is always-on and never goes through the
 * activator). Only models of providers the user has actually enabled
 * (`ai_providers.enabled = true`) are listed — `ai_models.enabled` alone is a
 * per-model row flag that catalog/batch syncs may set without the user
 * enabling the provider. Fail-open: any error means no guidance, same as the
 * activator.
 */
export const resolveSubAgentModelGuidance = async (
  serverDB: LobeChatDatabase,
  userId: string,
  workspaceId?: string,
): Promise<string | undefined> => {
  const availability = await resolveSubAgentModelAvailability(serverDB, userId, workspaceId);
  if (!availability) return undefined;

  const models: EnabledChatModelRow[] = [...availability.enabledModelsByProvider.entries()].flatMap(
    ([providerId, ids]) =>
      [...ids].map((id) => ({ enabled: true, id, providerId, type: 'chat' as const })),
  );
  return formatSubAgentModelGuidance(models);
};

/**
 * Minimal structural shape of a generated function tool (context-engine's
 * `UniformTool`). Kept local so this util stays decoupled from the engine's
 * internal types.
 */
interface GuidanceTargetTool {
  function?: {
    name?: string;
    parameters?: { properties?: Record<string, any> };
  };
}

/**
 * Append the guidance to the `model` parameter description of the
 * `lobe-agent.callSubAgent` function tool.
 *
 * The tool schema is the one channel that reaches the supervisor under BOTH
 * prompt modes: `full` renders manifest systemRoles as teaching blocks, while
 * `lean` drops every manifest.systemRole and keeps only tool schemas — so a
 * former systemRole append silently vanished for lean (效率) runs.
 *
 * The literal name is safe to construct here: both components match the name
 * generator's identity normalization and stay far below the MD5-compression
 * length threshold, so it equals what `generateToolName('lobe-agent',
 * 'callSubAgent')` emits on the wire.
 *
 * Mutates the matched tool in place — safe because generateToolsDetailed
 * produces fresh tool objects per run. Returns whether the target was found;
 * `false` means lobe-agent's manifest was trimmed (group / sub-agent runs drop
 * the callSubAgent api) or the shape changed, i.e. nothing to inject into.
 */
export const appendSubAgentModelGuidanceToCallSubAgentTool = (
  tools: GuidanceTargetTool[] | undefined,
  guidance: string,
): boolean => {
  const callSubAgentTool = tools?.find(
    (tool) => tool.function?.name === `${LobeAgentIdentifier}____${LobeAgentApiName.callSubAgent}`,
  );
  const modelParam = callSubAgentTool?.function?.parameters?.properties?.model;
  if (!modelParam) return false;

  modelParam.description = modelParam.description
    ? `${modelParam.description}\n\n${guidance}`
    : guidance;
  return true;
};
