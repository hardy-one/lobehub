'use client';

import type {
  HeterogeneousProviderConfig,
  ListHeterogeneousAgentModelsParams,
} from '@lobechat/types';
import { buildHeteroSpawnArgs } from '@lobechat/types';
import { useMemo } from 'react';
import useSWR from 'swr';

import { heterogeneousAgentCatalogService } from '@/services/heterogeneousAgent';

const DEDUPING_INTERVAL = 5 * 60 * 1000;

interface UseThinkingLevelsParams {
  cwd?: string;
  deviceId?: string;
  /** Only probe while the answer is usable — an open menu on a probeable target. */
  enabled: boolean;
  provider?: HeterogeneousProviderConfig;
  type: ListHeterogeneousAgentModelsParams['type'];
}

/**
 * The thinking levels the selected model actually serves, probed on the host
 * that will run the agent.
 *
 * Pi answers this per model, so the probe gets the run's own selector args —
 * including `--model` — and the args are part of the SWR key: switching models
 * re-probes instead of reusing the previous model's list. `levels` stays
 * `undefined` until an answer arrives (or forever, when the target cannot
 * probe), which callers treat as "keep the static vocabulary".
 */
export const useThinkingLevels = ({
  cwd,
  deviceId,
  enabled,
  provider,
  type,
}: UseThinkingLevelsParams) => {
  // Same builder as a real run: the probe must bind the model the run would use.
  const args = useMemo(() => buildHeteroSpawnArgs(provider) ?? [], [provider]);

  const response = useSWR(
    enabled
      ? [
          'heterogeneous-agent-thinking-levels',
          type,
          deviceId ?? 'local',
          cwd ?? '',
          provider?.command ?? '',
          args.join('\u0000'),
        ]
      : null,
    async () =>
      heterogeneousAgentCatalogService.getThinkingLevels({
        args,
        command: provider?.command,
        cwd,
        deviceId,
        env: provider?.env,
        type,
      }),
    {
      dedupingInterval: DEDUPING_INTERVAL,
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    },
  );

  const result = response.data;

  return {
    isLoading: response.isLoading,
    /** Undefined until a probe answers: callers fall back to the vocabulary. */
    levels: result?.status === 'success' ? result.levels : undefined,
  };
};
