import { describe, expect, it } from 'vitest';

import {
  privateDeviceGatewayBaseUrl,
  privateDeviceGatewayDiscovery,
  privateDeviceGatewayFallbackUrl,
} from '../privateDeviceGateway';

describe('privateDeviceGateway', () => {
  it('reads an http(s) endpoint as its own base URL', () => {
    expect(privateDeviceGatewayBaseUrl('https://gw.example.com/edge/')).toBe(
      'https://gw.example.com/edge',
    );
  });

  it('maps a socket endpoint onto the http(s) base the client builds from', () => {
    expect(privateDeviceGatewayBaseUrl('wss://gw.example.com')).toBe('https://gw.example.com');
    expect(privateDeviceGatewayBaseUrl('ws://localhost:8788/ws')).toBe('http://localhost:8788');
  });

  it('ignores an endpoint it cannot use', () => {
    expect(privateDeviceGatewayBaseUrl(undefined)).toBeUndefined();
    expect(privateDeviceGatewayBaseUrl('  ')).toBeUndefined();
    expect(privateDeviceGatewayBaseUrl('ftp://gw.example.com')).toBeUndefined();
  });

  it('advertises the private endpoint so the server is not asked', () => {
    expect(privateDeviceGatewayDiscovery('wss://gw.example.com')).toEqual({
      status: 'advertised',
      url: 'https://gw.example.com',
    });
    expect(privateDeviceGatewayDiscovery(undefined)).toBeUndefined();
  });

  it('falls back to the public address only on the private endpoint', () => {
    const privateEndpoint = { source: 'server' as const, url: 'https://gw.example.com' };

    expect(privateDeviceGatewayFallbackUrl('wss://gw.example.com', undefined, privateEndpoint)).toBe(
      'https://device-gateway.lobehub.com',
    );
    expect(
      privateDeviceGatewayFallbackUrl('wss://gw.example.com', 'http://localhost:8787', privateEndpoint),
    ).toBe('http://localhost:8787');
    expect(
      privateDeviceGatewayFallbackUrl('wss://gw.example.com', undefined, {
        source: 'server',
        url: 'https://other.example.com',
      }),
    ).toBeUndefined();
  });
});
