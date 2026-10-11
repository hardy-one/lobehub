export interface ChosenAgentGateway {
  source: 'advertised' | 'configured';
  url: string | undefined;
}

/** Select a candidate, not a reachability guarantee. The transport owns fallback. */
export const chooseAgentGatewayUrl = async (params: {
  advertised: string[];
  configuredUrl: string | undefined;
}): Promise<ChosenAgentGateway> => {
  const { advertised, configuredUrl } = params;
  const requiresTls =
    !configuredUrl || ['https:', 'wss:'].includes(new URL(configuredUrl).protocol);
  for (const candidate of advertised) {
    try {
      const url = new URL(candidate);
      if (!['https:', 'http:', 'wss:', 'ws:'].includes(url.protocol)) continue;
      if (requiresTls && !['https:', 'wss:'].includes(url.protocol)) continue;
      if (url.username || url.password) continue;
      return { source: 'advertised', url: candidate };
    } catch {
      continue;
    }
  }
  return { source: 'configured', url: configuredUrl };
};
