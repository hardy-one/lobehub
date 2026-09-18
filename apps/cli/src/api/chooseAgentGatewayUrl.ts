/**
 * Which agent gateway this machine should stream runs through.
 *
 * A deployment can offer its devices a gateway they reach more directly than the
 * public one (`PRIVATE_AGENT_GATEWAY_URL`), advertised first with the public
 * `AGENT_GATEWAY_URL` behind it as the fallback. Chosen once, at connect, and
 * never persisted per run: a run must not depend on this decision mid-flight.
 *
 * The Desktop and the web app are not affected — an HTTPS page cannot dial a
 * private `ws://` endpoint, so the browser keeps the public gateway.
 */

/** Reaching a same-network address is fast, or not a reachable address at all. */
const PROBE_TIMEOUT_MS = 1_500;

export interface ChosenAgentGateway {
  /** Why this URL won — surfaced in the connect log. */
  source: 'advertised' | 'configured';
  url: string | undefined;
}

/** Whether an origin answers at all; any HTTP status counts, only silence fails. */
const isReachable = async (url: string): Promise<boolean> => {
  try {
    await fetch(`${url.replace(/\/+$/, '')}/trpc/lambda`, {
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

export const chooseAgentGatewayUrl = async (params: {
  /** Gateways the deployment offers, in the order to try them. */
  advertised: string[];
  /** What this machine resolves on its own (`AGENT_GATEWAY_URL`, settings, official). */
  configuredUrl: string | undefined;
}): Promise<ChosenAgentGateway> => {
  const { advertised, configuredUrl } = params;

  for (const url of advertised) {
    if (await isReachable(url)) return { source: 'advertised', url };
  }

  return { source: 'configured', url: configuredUrl };
};
