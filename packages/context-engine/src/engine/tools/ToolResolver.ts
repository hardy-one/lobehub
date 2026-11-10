import { ToolNameResolver } from './ToolNameResolver';
import type {
  ActivatedStepTool,
  LobeToolManifest,
  OperationToolSet,
  ResolvedToolSet,
  StepToolDelta,
  ToolExecutor,
  ToolSource,
  UniformTool,
} from './types';
import { generateToolsFromManifest } from './utils';

/**
 * Unified tool resolution engine.
 *
 * Single entry-point that merges operation-level tools with step-level
 * dynamic activations (device, @tool mentions, LLM discovery, etc.)
 * and produces the final `ResolvedToolSet` consumed by `call_llm`.
 */
export class ToolResolver {
  /**
   * Resolve the final tool set for an LLM call.
   *
   * @param operationToolSet  Immutable tools determined at operation creation
   * @param stepDelta         Declarative tool changes for the current step
   * @param accumulatedActivations  Tools activated in previous steps (cumulative)
   */
  resolve(
    operationToolSet: OperationToolSet,
    stepDelta: StepToolDelta,
    accumulatedActivations: ActivatedStepTool[] = [],
    allowedToolNames?: string[],
    schemaToolIds?: readonly string[],
  ): ResolvedToolSet {
    // Start from operation-level snapshot (shallow copies, with safe defaults)
    let tools: UniformTool[] = [...(operationToolSet.tools ?? [])];
    const sourceMap: Record<string, ToolSource> = { ...operationToolSet.sourceMap };
    const executorMap: Record<string, ToolExecutor> = { ...operationToolSet.executorMap };
    const enabledToolIds: string[] = [...(operationToolSet.enabledToolIds ?? [])];

    // Only include manifests for enabled tools to prevent injecting
    // systemRole for disabled tools (e.g. web-browsing when search is off)
    const manifestMap: Record<string, LobeToolManifest> = {};
    for (const id of enabledToolIds) {
      if (operationToolSet.manifestMap[id]) {
        manifestMap[id] = operationToolSet.manifestMap[id];
      }
    }

    // On-demand manual loading also gates the schemas: a tool is described in
    // one place, so its manual and its function definitions travel together.
    // The set starts with the pinned tools plus whatever the caller passes and
    // grows as step-level activations land.
    let schemaIds: Set<string> | undefined;
    if (schemaToolIds) {
      schemaIds = new Set(schemaToolIds.filter((id) => !!manifestMap[id]));
      const idByToolName = new Map<string, string>();
      for (const [id, manifest] of Object.entries(manifestMap)) {
        for (const tool of generateToolsFromManifest(manifest)) {
          idByToolName.set(tool.function.name, id);
        }
      }
      tools = tools.filter((tool) => schemaIds!.has(idByToolName.get(tool.function.name) ?? ''));
    }

    // Apply accumulated step-level activations from previous steps
    for (const activation of accumulatedActivations) {
      this.applyActivation(activation, tools, manifestMap, sourceMap, enabledToolIds, schemaIds);
    }

    // Apply current step delta activations
    for (const activation of stepDelta.activatedTools) {
      this.applyActivation(activation, tools, manifestMap, sourceMap, enabledToolIds, schemaIds);
    }

    const shouldFilterByToolNames = allowedToolNames !== undefined;
    const allowedToolNameSet = new Set(allowedToolNames ?? []);
    const toolNameResolver = new ToolNameResolver();

    let promptManifestMap = manifestMap;
    if (shouldFilterByToolNames) {
      promptManifestMap = {};

      for (const [identifier, manifest] of Object.entries(manifestMap)) {
        const api = manifest.api.filter(({ name }) =>
          allowedToolNameSet.has(toolNameResolver.generate(identifier, name, manifest.type)),
        );

        if (api.length > 0) {
          promptManifestMap[identifier] = {
            ...manifest,
            api,
            ...(api.length < manifest.api.length && { systemRole: undefined }),
          };
        }
      }
    }

    // Handle deactivation (e.g. forceFinish strips all tools)
    if (stepDelta.deactivatedToolIds?.includes('*')) {
      return {
        enabledToolIds: [],
        executorMap,
        manifestMap, // keep manifests for ToolNameResolver
        promptManifestMap: {},
        sourceMap,
        tools: [],
      };
    }

    // Deduplicate tools by function name
    const seen = new Set<string>();
    const dedupedTools: UniformTool[] = [];
    for (const tool of tools) {
      if (shouldFilterByToolNames && !allowedToolNameSet.has(tool.function.name)) {
        continue;
      }
      if (!seen.has(tool.function.name)) {
        seen.add(tool.function.name);
        dedupedTools.push(tool);
      }
    }

    const resolvedEnabledToolIds = shouldFilterByToolNames
      ? enabledToolIds.filter((id) => !!promptManifestMap[id])
      : enabledToolIds;

    return {
      enabledToolIds: [...new Set(resolvedEnabledToolIds)],
      executorMap,
      manifestMap,
      promptManifestMap,
      sourceMap,
      tools: dedupedTools,
    };
  }

  private applyActivation(
    activation: { id: string; manifest?: LobeToolManifest; source?: string },
    tools: UniformTool[],
    manifestMap: Record<string, LobeToolManifest>,
    sourceMap: Record<string, ToolSource>,
    enabledToolIds: string[],
    schemaIds?: Set<string>,
  ): void {
    const known = manifestMap[activation.id];

    // A tool can be discoverable (its manifest is loaded so the activator can
    // name it) while its schemas are still held back by on-demand loading.
    // Activation is the only thing that releases them.
    if (known) {
      if (schemaIds && !schemaIds.has(activation.id)) {
        tools.push(...generateToolsFromManifest(known));
        schemaIds.add(activation.id);
      }
      return;
    }

    if (activation.manifest) {
      manifestMap[activation.id] = activation.manifest;
      const newTools = generateToolsFromManifest(activation.manifest);
      tools.push(...newTools);
      enabledToolIds.push(activation.id);
      schemaIds?.add(activation.id);

      // Only set source if not already present — the operation-level sourceMap
      // may already have the correct routing source (e.g., 'lobehubSkill', 'composio')
      // and the activation source ('discovery') should not overwrite it.
      if (activation.source && !sourceMap[activation.id]) {
        sourceMap[activation.id] = this.mapSource(activation.source);
      }
    }
  }

  private mapSource(source: string): ToolSource {
    switch (source) {
      case 'device': {
        return 'builtin';
      }
      case 'discovery':
      case 'active_tools':
      case 'mention': {
        return 'builtin';
      }
      default: {
        return 'builtin';
      }
    }
  }
}
