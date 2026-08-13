import { DEFAULT_PROVIDER } from '@lobechat/business-const';
import type { LobeAgentAgencyConfig, LobeAgentChatConfig } from '@lobechat/types';

export { DEFAULT_MINI_MODEL, DEFAULT_MODEL } from '@lobechat/business-const';

export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';

/**
 * Last-resort model for sub-agents spawned via `lobe-agent.callSubAgent`, used
 * only when neither an explicit `agencyConfig.subagent` override nor the
 * parent's effective model is available at the spawn site.
 *
 * Paired with `DEFAULT_PROVIDER` rather than a dedicated sub-agent provider, so
 * a build that swaps `@lobechat/business-const` (the cloud one routes through
 * its own official provider) moves the sub-agent along with the main model
 * instead of leaving it pointed at a provider that build doesn't serve.
 */
export const DEFAULT_SUB_AGENT_MODEL = 'deepseek-v4-flash';

/**
 * Resolve the model a sub-agent runs on, in precedence order:
 *
 * 1. Explicit `agencyConfig.subagent` override configured on the spawning agent.
 * 2. The parent run's effective model — same provider, same model. Multi-provider
 *    setups otherwise strand sub-agents on a provider the user has moved away
 *    from (Claude Code / Codex sub-agents inherit the parent model the same way).
 * 3. The global default, when the spawn site has no parent model at hand.
 *
 * Model and provider resolve as a pair: mixing one source's model id with
 * another source's provider would produce a `provider/model` combination the
 * user never configured.
 */
export const resolveSubAgentModel = (
  subagent: LobeAgentAgencyConfig['subagent'],
  parentModel?: { model?: string | null; provider?: string | null },
): { model: string; provider: string } => {
  if (subagent?.model)
    return { model: subagent.model, provider: subagent.provider || DEFAULT_PROVIDER };

  if (parentModel?.model)
    return { model: parentModel.model, provider: parentModel.provider || DEFAULT_PROVIDER };

  return { model: DEFAULT_SUB_AGENT_MODEL, provider: DEFAULT_PROVIDER };
};

/**
 * Resolve the model a `callSubAgent` run executes on when the caller may pass
 * an explicit per-call override (tool arguments), in precedence order:
 *
 * 1. Per-call `model` / `provider` from the tool arguments. A missing per-call
 *    provider falls back to the configured sub-agent provider, then the
 *    parent's provider, then the global default.
 * 2. Otherwise the static precedence of {@link resolveSubAgentModel}.
 */
export interface ResolvedSubAgentModel {
  /**
   * Whether the pair comes from an explicit user/agent choice (per-call tool
   * override, an `agencyConfig.subagent` override, or the parent run's
   * effective model). `false` only for the global default fallback pair
   * (`DEFAULT_SUB_AGENT_MODEL` / `DEFAULT_PROVIDER`) — the spawn site uses
   * this to exempt the platform-owned default from enabled-model validation
   * while still validating every explicitly configured pair.
   */
  explicit: boolean;
  model: string;
  provider: string;
}

/**
 * Same resolution as {@link resolveSubAgentModelWithCallOverride}, but also
 * reports whether the resolved pair is an explicit user/agent choice
 * (`explicit: true`) or the global default fallback (`explicit: false`).
 */
export const resolveSubAgentModelWithCallOverrideDetailed = (
  callOverride: { model?: string | null; provider?: string | null } | undefined,
  subagent: LobeAgentAgencyConfig['subagent'],
  parentModel?: { model?: string | null; provider?: string | null },
): ResolvedSubAgentModel => {
  if (callOverride?.model) {
    return {
      model: callOverride.model,
      provider:
        callOverride.provider || subagent?.provider || parentModel?.provider || DEFAULT_PROVIDER,
      explicit: true,
    };
  }

  if (subagent?.model)
    return {
      model: subagent.model,
      provider: subagent.provider || DEFAULT_PROVIDER,
      explicit: true,
    };

  if (parentModel?.model)
    return {
      model: parentModel.model,
      provider: parentModel.provider || DEFAULT_PROVIDER,
      explicit: true,
    };

  return { model: DEFAULT_SUB_AGENT_MODEL, provider: DEFAULT_PROVIDER, explicit: false };
};

export const resolveSubAgentModelWithCallOverride = (
  callOverride: { model?: string | null; provider?: string | null } | undefined,
  subagent: LobeAgentAgencyConfig['subagent'],
  parentModel?: { model?: string | null; provider?: string | null },
): { model: string; provider: string } => {
  const { model, provider } = resolveSubAgentModelWithCallOverrideDetailed(
    callOverride,
    subagent,
    parentModel,
  );
  return { model, provider };
};

/**
 * Structured identity of the denied model pair for the callSubAgent
 * enabled-model check (server spawn site and client runner). Copy is rendered
 * by callers through i18n (`error.subAgentModelDenied`), so both surfaces
 * surface identical guidance in the user's language.
 */
export const getSubAgentModelDeniedPair = (
  provider: string,
  model: string,
): { provider: string; model: string } => ({ model, provider });

/**
 * Resolve the effective chatConfig for a `callSubAgent` run: the parent's
 * chatConfig with the agent's `agencyConfig.subagent.chatConfig` overrides
 * (thinking / reasoning-effort extend params) merged on top.
 *
 * `null` / `undefined` override values are skipped rather than copied — a
 * cleared override falls back to the parent value, mirroring how a nulled
 * `subagent.model` falls back to following the parent model.
 */
/**
 * The chatConfig override to apply to a spawned sub-agent, gated on an explicit
 * `subagent.model`: the thinking / reasoning-effort overrides are configured in
 * the UI under the chosen override model, so once the model is cleared (back to
 * follow-parent) a stale `chatConfig` left behind by older writers must not
 * silently keep changing the sub-agent's behavior or cost.
 */
export const getSubAgentChatConfigOverride = (
  subagent: LobeAgentAgencyConfig['subagent'],
): Partial<LobeAgentChatConfig> | undefined =>
  subagent?.model ? (subagent.chatConfig ?? undefined) : undefined;

export const resolveSubAgentChatConfig = <T extends object>(
  parentChatConfig: T | null | undefined,
  override: Partial<T> | null | undefined,
): T | undefined => {
  if (!override) return parentChatConfig ?? undefined;

  const patch = Object.fromEntries(
    Object.entries(override).filter(([, value]) => value !== null && value !== undefined),
  );

  return { ...parentChatConfig, ...patch } as T;
};

export const DEFAULT_RERANK_MODEL = 'rerank-english-v3.0';
export const DEFAULT_RERANK_PROVIDER = 'cohere';
export const DEFAULT_RERANK_QUERY_MODE = 'full_text';
