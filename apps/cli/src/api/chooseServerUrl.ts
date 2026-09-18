/** Reaching a private address is a same-network trip: fast, or not at all. */
const PROBE_TIMEOUT_MS = 1_500;

export interface ChosenServerUrl {
  /** Why this URL won — surfaced in the connect log and by `lh doctor`. */
  source: 'advertised' | 'configured';
  url: string;
}

/** Whether an origin answers at all; any HTTP status counts, only silence fails. */
const isReachable = async (url: string): Promise<boolean> => {
  try {
    await fetch(`${url}/trpc/lambda`, {
      body: '{}',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return true;
  } catch {
    return false;
  }
};

/**
 * Choose the address this machine will use from now on: one the deployment
 * advertises for its devices, if it can be reached, otherwise the server URL the
 * machine is configured with (`--server`).
 *
 * Called once, at connect, and the answer is stored in `settings.json` — after
 * that the CLI has exactly one server URL, hands exactly one to the processes it
 * spawns, and never re-decides. Re-deciding per request is what would require
 * two addresses, a fallback path in every client, and a freshness rule for the
 * answer; if the private path goes away, the next connect re-evaluates it.
 */
export const chooseServerUrl = async (params: {
  /** Addresses the deployment offers, in the order to try them. */
  advertised: string[];
  /** The server `lh login` stored — the fallback, never the answer being verified. */
  configuredUrl: string;
}): Promise<ChosenServerUrl> => {
  const { advertised, configuredUrl } = params;

  // Every advertised address is probed, including one that happens to equal what
  // this machine resolves to right now: that value *is* the address verified at an
  // earlier connect, so skipping it would leave the address in use unverified and
  // report it as unreachable while still dialling it.
  for (const url of advertised) {
    if (await isReachable(url)) return { source: 'advertised', url };
  }

  return { source: 'configured', url: configuredUrl };
};
