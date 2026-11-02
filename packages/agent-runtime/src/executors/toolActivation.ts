import { validateAtomicCapabilityBundle } from '@lobechat/context-engine/onDemand';
import type {
  OnDemandCapabilityExpectation,
  OnDemandDiscoveryPool,
} from '@lobechat/types';

import type { ToolRunResult } from '../transport';
import type { AgentState } from '../types';

interface ActivatedToolResult {
  data: ToolRunResult;
}

const resolveOnDemandActivation = (
  discoveryPool: OnDemandDiscoveryPool,
  tool: { capability?: OnDemandCapabilityExpectation; identifier: string },
) => {
  const card = discoveryPool.cards.find((item) => item.identifier === tool.identifier);
  const bundle = discoveryPool.bundles[tool.identifier];
  if (!card || !bundle || card.hash !== bundle.hash || card.version !== bundle.version) {
    return;
  }

  const capability =
    tool.capability ??
    ({
      hash: card.hash,
      identifier: card.identifier,
      version: card.version,
    } satisfies OnDemandCapabilityExpectation);
  if (
    capability.identifier !== card.identifier ||
    capability.version !== card.version ||
    capability.hash !== card.hash
  ) {
    return;
  }

  const validation = validateAtomicCapabilityBundle(bundle, capability);
  return validation.ok ? { capability, manifest: validation.bundle.manifest } : undefined;
};

export const persistActivatedTools = ({
  effectiveManifestMap,
  newState,
  results,
  stepCount,
}: {
  effectiveManifestMap: Record<string, any>;
  newState: AgentState;
  results: ActivatedToolResult[];
  stepCount: number;
}) => {
  const existingIds = new Set((newState.activatedStepTools ?? []).map((tool) => tool.id));
  const discoveryPool = newState.operationToolSet?.discoveryPool;

  for (const result of results) {
    const discoveredTools = result.data.state?.activatedTools as
      | Array<{
          capability?: OnDemandCapabilityExpectation;
          identifier: string;
        }>
      | undefined;
    if (!discoveredTools?.length) continue;

    // Update the set inside the filter so duplicate ids in one batch are dropped.
    const newActivations = discoveredTools
      .filter((tool) => {
        if (existingIds.has(tool.identifier)) return false;
        existingIds.add(tool.identifier);
        return true;
      })
      .flatMap((tool) => {
        if (!discoveryPool) {
          return [
            {
              activatedAtStep: stepCount,
              id: tool.identifier,
              manifest: effectiveManifestMap[tool.identifier],
              source: 'discovery' as const,
            },
          ];
        }

        const resolved = resolveOnDemandActivation(discoveryPool, tool);
        return resolved
          ? [
              {
                activatedAtStep: stepCount,
                capability: resolved.capability,
                id: tool.identifier,
                manifest: resolved.manifest,
                source: 'discovery' as const,
              },
            ]
          : [];
      });

    if (newActivations.length > 0) {
      newState.activatedStepTools = [...(newState.activatedStepTools ?? []), ...newActivations];
    }
  }
};
