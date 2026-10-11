import { getTrpcClient } from './client';

/**
 * Addresses this deployment offers its devices (`aiAgent.heteroRuntimeEndpoints`):
 * app origins to stream events to (`PRIVATE_APP_URLS`) and agent gateways to stream
 * a run through (private first, public as the fallback).
 *
 * Asked **once, at connect** — never per run. A run must not depend on a lookup,
 * so nothing here is cached, refreshed or re-checked: connect decides, and
 * everything afterwards uses the address it picked.
 */
export interface AdvertisedRuntimeEndpoints {
  agentGatewayUrls: string[];
  serverUrls: string[];
}

const EMPTY: AdvertisedRuntimeEndpoints = { agentGatewayUrls: [], serverUrls: [] };

const normalize = (urls: unknown): string[] =>
  Array.isArray(urls)
    ? urls
        .filter((url): url is string => typeof url === 'string')
        .map((url) => url.trim().replace(/\/+$/, ''))
        .filter(Boolean)
    : [];

export const fetchAdvertisedRuntimeEndpoints = async (options?: {
  timeoutMs?: number;
}): Promise<AdvertisedRuntimeEndpoints> => {
  try {
    const client = await getTrpcClient();
    const result = await Promise.race([
      client.aiAgent.heteroRuntimeEndpoints.query(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('endpoint lookup timed out')),
          options?.timeoutMs ?? 15_000,
        ),
      ),
    ]);

    return {
      agentGatewayUrls: normalize(result?.agentGatewayUrls),
      serverUrls: normalize(result?.serverUrls),
    };
  } catch {
    // "The server offers none" and "I could not ask" lead to the same place: the
    // addresses this machine is configured with.
    return EMPTY;
  }
};
