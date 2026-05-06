import { isDesktop as defaultIsDesktop } from '@lobechat/const';
import { type HeterogeneousProviderConfig } from '@lobechat/types';

/**
 * Which agent runtime should handle an operation.
 *
 * - `client`: in-browser AgentRuntime (default)
 * - `gateway`: cloud sandbox via Gateway WebSocket
 * - `serverSse`: server-side execution with SSE fallback (self-hosted)
 * - `hetero`: heterogeneous CLI agent (Claude Code, Codex, …) via desktop IPC or sandbox
 */
export type AgentRuntimeType = 'client' | 'gateway' | 'serverSse' | 'hetero';

export interface RuntimeSelectionContext {
  /** Per-agent heterogeneous provider config (desktop only — takes priority over gateway). */
  heterogeneousProvider?: HeterogeneousProviderConfig;
  /** Result of `chatStore.isGatewayModeEnabled()`. */
  isGatewayMode: boolean;
  /** Result of `chatStore.isServerSseEnabled()`. */
  isServerSseMode: boolean;
  /**
   * Explicit override that wins over automatic selection.
   *
   * Used by sub-agent dispatches (`directMentionRoute`, `callAgent`) so child
   * operations inherit the parent operation's runtime instead of re-running
   * the global decision — a sub-agent spawned inside a Gateway run should
   * stay on Gateway, even if its own agent config would say otherwise.
   */
  parentRuntime?: AgentRuntimeType;
}

interface SelectRuntimeTypeOptions {
  /** Override of `isDesktop` for testability. Defaults to the build-time const. */
  isDesktop?: boolean;
}

/**
 * Centralized "which runtime should run this agent operation" decision.
 *
 * The same priority is applied at every entry point (sendMessage, regenerate,
 * resume, continue, sub-agent dispatch, …) so adding a new entry point does
 * not require re-deriving the routing rules.
 *
 * Priority: `parentRuntime` > `hetero` (desktop only) > `gateway` > `serverSse` > `client`.
 */
export const selectRuntimeType = (
  ctx: RuntimeSelectionContext,
  { isDesktop = defaultIsDesktop }: SelectRuntimeTypeOptions = {},
): AgentRuntimeType => {
  const runtimeType = resolveRuntimeType(ctx, isDesktop);
  console.log(
    `[RT-Dispatch] mode=${runtimeType}, parent=${ctx.parentRuntime ?? 'none'}, ` +
    `gateway=${ctx.isGatewayMode}, serverSse=${ctx.isServerSseMode}, ` +
    `hetero=${!!(isDesktop && ctx.heterogeneousProvider)}`,
  );
  return runtimeType;
};

const resolveRuntimeType = (
  ctx: RuntimeSelectionContext,
  isDesktop: boolean,
): AgentRuntimeType => {
  if (ctx.parentRuntime) return ctx.parentRuntime;
  if (isDesktop && ctx.heterogeneousProvider) return 'hetero';
  if (ctx.isGatewayMode) return 'gateway';
  if (ctx.isServerSseMode) return 'serverSse';
  return 'client';
};
