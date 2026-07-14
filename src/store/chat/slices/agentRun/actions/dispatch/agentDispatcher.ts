import { isDesktop as defaultIsDesktop } from '@lobechat/const';
import { isRemoteHeterogeneousType } from '@lobechat/heterogeneous-agents';
import type {
  DeviceExecutionTarget,
  HeterogeneousProviderConfig,
  LobeAgentAgencyConfig,
} from '@lobechat/types';

import {
  resolveEffectiveExecutionTargetConfig,
  resolveExecutionTarget,
} from '@/helpers/executionTarget';
import { getAgentStoreState } from '@/store/agent';
import { agentByIdSelectors, agentSelectors } from '@/store/agent/selectors';
import { getUserStoreState } from '@/store/user';
import { workspaceUserSettingsSelectors } from '@/store/user/selectors';
import {
  agentExecutionTargetPreferenceKey,
  topicExecutionTargetPreferenceKey,
} from '@/store/user/slices/executionTargetPreference/initialState';

/**
 * Which agent runtime should handle an operation.
 *
 * - `client`: in-browser AgentRuntime (default)
 * - `gateway`: cloud sandbox via Gateway WebSocket
 * - `hetero`: heterogeneous CLI agent (Claude Code, Codex, …) via desktop IPC or sandbox
 */
export type AgentRuntimeType = 'client' | 'gateway' | 'hetero';

/**
 * Unified intent for a non-hetero, non-group sub-agent invocation.
 *
 * All three caller patterns (`callSubAgent` / `callAgent` / `@agent`) map
 * their parameters into this shape before handing off to
 * `dispatchNonHeteroSubAgent`. Runtime routing is entirely the dispatcher's
 * responsibility — callers only declare *what* they want, not *how* to run it.
 *
 * Excluded from this contract:
 * - Hetero agents (handled by the heterogeneous pipeline)
 * - Group orchestration (handled by `groupOrchestration.triggerSpeak`)
 * - Async task mode (handled by the `execSubAgent` executor via state.type)
 */
export interface AgentInvocationIntent {
  /**
   * Instruction delivered to the sub-agent.
   * In client mode it is injected as a virtual user message prepended to the
   * existing message history. In gateway mode it becomes the `message` param
   * of `executeGatewayAgent` (i.e. a real user message on the server).
   */
  instruction: string;
  /**
   * Which invocation pattern produced this intent.
   * Preserved for logging / debugging; has no effect on runtime selection.
   */
  kind: 'callAgent' | 'callSubAgent' | 'mention';
  /**
   * ID of the tool result message that triggered this invocation.
   * Used as `parentMessageId` by the client executor.
   */
  parentMessageId: string;
  /** Target agent to execute. */
  targetAgentId: string;
}

export interface RuntimeSelectionContext {
  /** Device bound by the execution switcher. Used when desktop `local` syncs to web. */
  boundDeviceId?: string;
  /**
   * Per-agent execution device choice from the composer's Execution Device
   * switcher. Only meaningful when `heterogeneousProvider` is a local CLI
   * (claude-code / codex). Controls the desktop fork:
   *   - `'device'` / `'sandbox'` → route through Gateway so the server can
   *     dispatch to an `lh connect` device or spawn a sandbox.
   *   - `'local'` / `undefined`  → keep today's default (desktop → `hetero`
   *     in-process spawn, web → `gateway` sandbox unless a desktop-local
   *     boundDeviceId is available, in which case the server dispatches to it.
   */
  executionTarget?: DeviceExecutionTarget;
  /** Per-agent heterogeneous provider config (desktop only — takes priority over gateway). */
  heterogeneousProvider?: HeterogeneousProviderConfig;
  /** Result of `chatStore.isGatewayModeEnabled()`. */
  isGatewayMode: boolean;
  /**
   * The agent is workspace-scoped (`agent.workspaceId` set). Workspace agents
   * never execute in-process on the current member's own desktop — a
   * default/stored `local` target coerces to sandbox/device, so the run
   * routes through the gateway (see `resolveExecutionTarget`'s
   * `workspaceScoped`).
   */
  isWorkspaceAgent?: boolean;
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
 * Priority: `parentRuntime` > `hetero` (desktop only) > `gateway` > `client`.
 */
export const selectRuntimeType = (
  ctx: RuntimeSelectionContext,
  { isDesktop = defaultIsDesktop }: SelectRuntimeTypeOptions = {},
): AgentRuntimeType => {
  if (ctx.parentRuntime) return ctx.parentRuntime;
  // Remote device agents (openclaw / hermes) always use the gateway path regardless of
  // desktop/web — they communicate via a device connected with `lh connect`, not via
  // local desktop IPC. No special desktop handling needed.
  if (ctx.heterogeneousProvider && isRemoteHeterogeneousType(ctx.heterogeneousProvider.type)) {
    return 'gateway';
  }
  // Local CLI hetero (claude-code / codex) — route by the resolved execution
  // target (shared resolution with the server / the device switcher UI):
  // `device` / `sandbox` need server-side dispatch; `local` runs in-process on
  // the desktop. On web, unbound `local` resolves to sandbox, while a desktop
  // `local` selection synced with boundDeviceId resolves to device dispatch.
  if (ctx.heterogeneousProvider) {
    const target = resolveExecutionTarget(
      { boundDeviceId: ctx.boundDeviceId, executionTarget: ctx.executionTarget },
      // on the client the desktop build IS where local execution is available
      {
        isHetero: true,
        clientExecutionAvailable: isDesktop,
        workspaceScoped: ctx.isWorkspaceAgent,
      },
    );
    return target === 'local' ? 'hetero' : 'gateway';
  }
  if (ctx.isGatewayMode) return 'gateway';
  return 'client';
};

interface ResolvedRuntimeConfig {
  agencyConfig?: LobeAgentAgencyConfig;
  hasSourcePreference: boolean;
  runtimeType: AgentRuntimeType;
}

export interface CachedExecutionTargetConfig {
  agencyConfig?: LobeAgentAgencyConfig;
  hasSourcePreference: boolean;
  heterogeneousProvider?: HeterogeneousProviderConfig;
  isWorkspaceAgent: boolean;
}

export const getCachedExecutionTargetConfig = (params: {
  agentId: string;
  topicId?: string | null;
}): CachedExecutionTargetConfig => {
  const agentState = getAgentStoreState();
  const agentConfig = agentSelectors.getAgentConfigById(params.agentId)(agentState);
  const userState = getUserStoreState();
  const agentPreference =
    userState.executionTargetPreferenceMap[agentExecutionTargetPreferenceKey(params.agentId)];
  const topicPreference = params.topicId
    ? userState.executionTargetPreferenceMap[topicExecutionTargetPreferenceKey(params.topicId)]
    : undefined;

  return {
    agencyConfig: resolveEffectiveExecutionTargetConfig(
      agentConfig?.agencyConfig,
      workspaceUserSettingsSelectors.agentDeviceOverrideById(params.agentId)(userState),
      agentPreference,
      topicPreference,
    ),
    hasSourcePreference: agentPreference != null || topicPreference != null,
    heterogeneousProvider: agentConfig?.agencyConfig?.heterogeneousProvider,
    isWorkspaceAgent: agentByIdSelectors.isWorkspaceAgentById(params.agentId)(agentState),
  };
};

export const resolveRuntimeConfig = async (params: {
  agentId: string;
  isGatewayMode: boolean;
  parentRuntime?: AgentRuntimeType;
  topicId?: string | null;
}): Promise<ResolvedRuntimeConfig> => {
  const agentState = getAgentStoreState();
  const agentConfig = agentSelectors.getAgentConfigById(params.agentId)(agentState);
  const heterogeneousProvider = agentConfig?.agencyConfig?.heterogeneousProvider;

  if (
    params.parentRuntime ||
    (heterogeneousProvider && isRemoteHeterogeneousType(heterogeneousProvider.type))
  ) {
    return {
      agencyConfig: agentConfig?.agencyConfig,
      hasSourcePreference: false,
      runtimeType: selectRuntimeType({
        heterogeneousProvider,
        isGatewayMode: params.isGatewayMode,
        parentRuntime: params.parentRuntime,
      }),
    };
  }

  const userState = getUserStoreState();
  await userState.ensureExecutionTargetPreference({
    agentId: params.agentId,
    ...(params.topicId ? { topicId: params.topicId } : {}),
  });
  const cached = getCachedExecutionTargetConfig(params);

  return {
    agencyConfig: cached.agencyConfig,
    hasSourcePreference: cached.hasSourcePreference,
    runtimeType: selectRuntimeType({
      boundDeviceId: cached.agencyConfig?.boundDeviceId,
      executionTarget: cached.agencyConfig?.executionTarget,
      heterogeneousProvider: cached.heterogeneousProvider,
      isGatewayMode: params.isGatewayMode,
      isWorkspaceAgent: cached.isWorkspaceAgent && !cached.hasSourcePreference,
    }),
  };
};

export const resolveRuntimeType = async (
  params: Parameters<typeof resolveRuntimeConfig>[0],
): Promise<AgentRuntimeType> => (await resolveRuntimeConfig(params)).runtimeType;
