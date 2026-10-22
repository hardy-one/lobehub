import { OFFICIAL_DEVICE_GATEWAY_URL } from '@lobechat/const/url';
import {
  type DeviceGatewayDiscovery,
  type DeviceGatewayEndpoint,
  normalizeDeviceGatewayUrl,
} from '@lobechat/device-gateway-client/endpoint';

/**
 * A deployment can hand a signed-in desktop a private Device Gateway for its
 * persistent device socket (`aiAgent.heteroRuntimeEndpoints`). This module owns
 * how that endpoint is used next to the server's own public advertisement: the
 * scheme mapping, the discovery it stands in for, and the public address the
 * socket falls back to when delivery fails on it.
 */

/**
 * The advertised endpoint as a gateway base URL, or `undefined` when none was
 * handed over. The endpoint list carries socket URLs (`wss://host`), while the
 * client derives the socket from an http(s) base, so the scheme maps back.
 */
export const privateDeviceGatewayBaseUrl = (advertised?: string): string | undefined => {
  const raw = advertised?.trim();
  if (!raw) return undefined;

  const direct = normalizeDeviceGatewayUrl(raw);
  if (direct) return direct;
  if (!/^wss?:\/\//i.test(raw)) return undefined;

  return normalizeDeviceGatewayUrl(raw.replace(/^ws/i, 'http').replace(/\/ws$/, ''));
};

/**
 * The discovery result the private endpoint stands in for, or `undefined` to let
 * the server answer for itself.
 */
export const privateDeviceGatewayDiscovery = (
  advertised?: string,
): DeviceGatewayDiscovery | undefined => {
  const url = privateDeviceGatewayBaseUrl(advertised);
  return url ? { status: 'advertised', url } : undefined;
};

/**
 * The public address a socket opened on the private endpoint falls back to when
 * delivery fails there: the address saved for this server, else the official
 * gateway. `undefined` keeps the client on whatever the resolution chose.
 */
export const privateDeviceGatewayFallbackUrl = (
  advertised: string | undefined,
  savedGatewayUrl: string | undefined,
  endpoint: DeviceGatewayEndpoint,
): string | undefined => {
  const url = privateDeviceGatewayBaseUrl(advertised);
  if (!url || endpoint.url !== url) return undefined;

  return savedGatewayUrl ?? OFFICIAL_DEVICE_GATEWAY_URL;
};
