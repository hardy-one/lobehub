/**
 * Which address the Desktop should use for device traffic (agent runs and the
 * events they stream back).
 *
 * A deployment can offer its devices an address they reach more directly than
 * the public entry (`PRIVATE_APP_URLS`, served by
 * `aiAgent.heteroRuntimeEndpoints`), and only the deployment knows it: a
 * container cannot discover the address by which devices reach it.
 *
 * The choice is made once per app session and is not persisted — an address is a
 * property of this session, so a deployment that moves it is picked up the next
 * time the app resolves it instead of being remembered stale. Callers that must
 * not wait (a gateway connection, a spawn) keep using the configured URL until
 * the answer lands.
 */

/** Reaching a same-network address is fast, or not a reachable address at all. */
export const DEVICE_ADDRESS_PROBE_TIMEOUT_MS = 1_500;

/** Whether an origin answers at all; any HTTP status counts, only silence fails. */
export const probeDeviceAddress = async (
  url: string,
  timeoutMs = DEVICE_ADDRESS_PROBE_TIMEOUT_MS,
): Promise<boolean> => {
  try {
    await fetch(`${url.replace(/\/+$/, '')}/trpc/lambda`, {
      body: '{}',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return true;
  } catch {
    return false;
  }
};

/**
 * The first advertised address this machine can actually reach, otherwise the
 * configured server URL.
 *
 * Every advertised address is probed, including one equal to the configured URL:
 * an address that is *in use* must still be verified rather than assumed, which
 * is a mistake made once already on the CLI side.
 */
export const pickDeviceServerUrl = async (params: {
  advertised: string[];
  configuredUrl?: string;
  probe?: (url: string) => Promise<boolean>;
}): Promise<string | undefined> => {
  const { advertised, configuredUrl } = params;
  const probe = params.probe ?? probeDeviceAddress;

  for (const url of advertised) {
    if (await probe(url)) return url;
  }

  return configuredUrl;
};
