import { getTrpcClient } from './client';

/**
 * Addresses this deployment offers its devices (`aiAgent.heteroRuntimeEndpoints`,
 * fed by the server's `PRIVATE_APP_URLS`).
 *
 * Asked **once, at connect** — never per run. A run must not depend on a lookup,
 * so nothing here is cached, refreshed or re-checked: connect decides, and
 * everything afterwards uses the one address it stored.
 */
export const fetchAdvertisedServerUrls = async (options?: {
  timeoutMs?: number;
}): Promise<string[]> => {
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

    return (result?.serverUrls ?? []).map((url) => url.trim().replace(/\/+$/, '')).filter(Boolean);
  } catch {
    // "The server offers none" and "I could not ask" lead to the same place: the
    // URL this machine is configured with.
    return [];
  }
};
