import type {
  HeterogeneousAgentModelCatalog,
  HeterogeneousThinkingLevels,
  ListHeterogeneousAgentModelsParams,
} from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';
import { heterogeneousAgentService as electronHeterogeneousAgentService } from '@/services/electron/heterogeneousAgent';

interface ListModelsParams extends ListHeterogeneousAgentModelsParams {
  deviceId?: string;
}

/**
 * Model-catalog transport boundary. A bound target goes through the device
 * gateway; an unbound target is the current Desktop and uses Electron IPC.
 */
class HeterogeneousAgentCatalogService {
  listModels({ deviceId, ...params }: ListModelsParams): Promise<HeterogeneousAgentModelCatalog> {
    return deviceId
      ? lambdaClient.device.listHeterogeneousAgentModels.query({ deviceId, ...params })
      : electronHeterogeneousAgentService.listModels(params);
  }

  /**
   * Thinking levels the selected model serves.
   *
   * Only the local Desktop can probe today: the device gateway answers the
   * model catalog but has no thinking-level RPC, so a bound device target
   * resolves to `undefined` and the selector keeps its static vocabulary
   * (Pi clamps an unsupported level instead of failing).
   */
  async getThinkingLevels({
    deviceId,
    ...params
  }: ListModelsParams): Promise<HeterogeneousThinkingLevels | undefined> {
    // A bound device answers through its own gateway RPC; only a client too old
    // to know the method falls back to the static vocabulary upstream.
    if (deviceId) {
      return lambdaClient.device.probeHeterogeneousThinkingLevels.query({ deviceId, ...params });
    }

    return electronHeterogeneousAgentService.getThinkingLevels(params);
  }
}

export const heterogeneousAgentCatalogService = new HeterogeneousAgentCatalogService();
