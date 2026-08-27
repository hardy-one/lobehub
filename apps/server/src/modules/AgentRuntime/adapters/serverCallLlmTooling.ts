import type { AgentState } from '@lobechat/agent-runtime';
import { LocalSystemManifest } from '@lobechat/builtin-tool-local-system';
import { MemoryManifest } from '@lobechat/builtin-tool-memory';
import {
  buildStepSkillDelta,
  buildStepToolDelta,
  type LobeToolManifest,
  type OperationToolSet,
  type ResolvedSkillSet,
  type ResolvedToolSet,
  SkillResolver,
  ToolResolver,
} from '@lobechat/context-engine';

import type { ExecutionPlan } from '@/helpers/executionTarget';

import type { RuntimeExecutorContext } from '../context';
import { log } from '../executorHelpers';
import { resolveRunActiveDeviceId } from '../executors/resolveRunActiveDeviceId';

export interface ServerCallLlmTooling {
  /**
   * The device actually routed for this run, if any (same single-track gate
   * `buildStepToolDelta` uses below). Exposed so callers building prompt
   * template variables can tell whether `runCommand`/`execScript` will
   * execute on a device instead of falling back to the cloud sandbox —
   * `resolved.enabledToolIds.includes('lobe-cloud-sandbox')` alone doesn't
   * cover it, since Skills' sandbox fallback applies whenever no device is
   * routed, independent of whether the dedicated Cloud Sandbox tool is
   * offered.
   */
  activeDeviceId?: string;
  /**
   * The run's resolved execution target (`local`/`device`/`sandbox`/`auto`/
   * `none`), straight from `state.metadata.executionPlan.target`. Exposed
   * alongside `activeDeviceId` because `'auto'` is the one target where a
   * device can be routed (`activeDeviceId` set) while the cloud sandbox is
   * *also* reachable — see `AgentToolsEngine`'s `agentModeRules` gate for
   * `lobe-cloud-sandbox`, which allows it for `'auto'` regardless of routing.
   */
  executionTarget?: ExecutionPlan['target'];
  resolved: ResolvedToolSet;
  resolvedSkills?: ResolvedSkillSet;
  tools?: ResolvedToolSet['tools'];
  /** Compact discovery list for tools not enabled in the current step. */
  availableTools?: Array<{
    identifier: string;
    name: string;
    description: string;
  }>;
}

export const resolveServerCallLlmTooling = (
  ctx: Pick<RuntimeExecutorContext, 'operationId' | 'stepIndex'>,
  state: AgentState,
  allowedToolNames?: string[],
): ServerCallLlmTooling => {
  // Resolve tools via ToolResolver (unified tool injection).
  //
  // Single-track device gate: `buildStepToolDelta` treats activeDeviceId as
  // an independent activation signal (it only dedupes against already-
  // enabled tools), so any id that reaches it WILL inject local-system.
  // `resolveRunActiveDeviceId` swallows the id whenever the plan/policy
  // forbids devices — the same filter the tool executors apply.
  const activeDeviceId = resolveRunActiveDeviceId(state.metadata);
  const executionTarget = (state.metadata?.executionPlan as ExecutionPlan | undefined)?.target;
  const operationToolSet: OperationToolSet = state.operationToolSet ?? {
    enabledToolIds: [],
    executorMap: state.toolExecutorMap ?? {},
    manifestMap: state.toolManifestMap ?? {},
    sourceMap: state.toolSourceMap ?? {},
    tools: state.tools ?? [],
  };

  const stepDelta = buildStepToolDelta({
    activeDeviceId,
    enabledToolIds: operationToolSet.enabledToolIds,
    forceFinish: state.forceFinish,
    localSystemManifest: LocalSystemManifest as unknown as LobeToolManifest,
    operationManifestMap: operationToolSet.manifestMap,
  });

  const toolResolver = new ToolResolver();
  const resolved: ResolvedToolSet = toolResolver.resolve(
    operationToolSet,
    stepDelta,
    state.activatedStepTools ?? [],
    allowedToolNames,
  );

  const tools = resolved.tools.length > 0 ? resolved.tools : undefined;

  if (stepDelta.activatedTools.length > 0) {
    log(
      `[${ctx.operationId}:${ctx.stepIndex}] ToolResolver injected %d step-level tools: %o`,
      stepDelta.activatedTools.length,
      stepDelta.activatedTools.map((tool) => tool.id),
    );
  }

  // Resolve skills via SkillResolver (unified skill injection).
  const skillResolver = new SkillResolver();
  const stepSkillDelta = buildStepSkillDelta();
  const resolvedSkills = state.metadata?.operationSkillSet
    ? skillResolver.resolve(
        state.metadata.operationSkillSet,
        stepSkillDelta,
        state.activatedStepSkills ?? [],
      )
    : undefined;

  const enabledIds = new Set([
    ...(operationToolSet.enabledToolIds ?? []),
    ...(resolved.enabledToolIds ?? []),
  ]);
  const userMemoryEnabled = !!(state.metadata?.userMemory?.memories);
  const useAppSearch =
    state.metadata?.searchDecision?.useApplicationBuiltinSearchTool !== false;

  const availableTools = Object.entries(operationToolSet.manifestMap ?? {})
    .filter(([id]) => !enabledIds.has(id))
    .filter(([id]) => {
      // Respect UI/runtime gates: these tools must not be activatable when the
      // corresponding switch is off.
      if (id === MemoryManifest.identifier) return userMemoryEnabled;
      if (id === LocalSystemManifest.identifier) return true; // already gated by device policy
      return true;
    })
    .filter(([id]) => {
      // Web-browsing is only activatable when the application built-in search
      // tool is actually enabled by the search decision.
      if (id === 'lobe-web-browsing') return useAppSearch;
      return true;
    })
    .map(([id, manifest]) => ({
      description: manifest.meta?.description ?? '',
      identifier: id,
      name: manifest.meta?.title ?? id,
    }));

  return {
    activeDeviceId,
    executionTarget,
    resolved,
    resolvedSkills,
    tools,
    ...(availableTools.length > 0 ? { availableTools } : {}),
  };
};
