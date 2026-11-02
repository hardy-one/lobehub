import type { ConnectionStatus } from '@lobechat/agent-gateway-client';

const GATEWAY_CONNECT_WAIT_MS = 5000;

/** Resolve once the connection reads `connected`, or after a bounded wait. */
export const waitForGatewayConnected = async (
  readStatus: () => ConnectionStatus | undefined,
): Promise<boolean> => {
  const deadline = Date.now() + GATEWAY_CONNECT_WAIT_MS;
  while (readStatus() !== 'connected' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return readStatus() === 'connected';
};
