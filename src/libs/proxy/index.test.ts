import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { dispatcher, mockEnvHttpProxyAgent, mockSetGlobalDispatcher } = vi.hoisted(() => {
  const dispatcher = { name: 'proxy-dispatcher' };

  return {
    dispatcher,
    mockEnvHttpProxyAgent: vi.fn(() => dispatcher),
    mockSetGlobalDispatcher: vi.fn(),
  };
});

vi.mock('undici', () => ({
  EnvHttpProxyAgent: mockEnvHttpProxyAgent,
  setGlobalDispatcher: mockSetGlobalDispatcher,
}));

const proxyEnvKeys = ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy'] as const;
const originalEnv = new Map(proxyEnvKeys.map((key) => [key, process.env[key]]));

const clearProxyEnv = () => {
  for (const key of proxyEnvKeys) delete process.env[key];
};

const loadProxyModule = async () => {
  vi.resetModules();
  await import('./index');
};

beforeEach(() => {
  clearProxyEnv();
  vi.clearAllMocks();
});

afterEach(() => {
  clearProxyEnv();
  for (const [key, value] of originalEnv) {
    if (value !== undefined) process.env[key] = value;
  }
  vi.resetModules();
});

describe('global provider proxy dispatcher', () => {
  it('configures an HTTP-only proxy', async () => {
    process.env.HTTP_PROXY = 'http://http-proxy.test:8080';

    await loadProxyModule();

    expect(mockEnvHttpProxyAgent).toHaveBeenCalledWith({
      httpProxy: 'http://http-proxy.test:8080',
      httpsProxy: undefined,
      noProxy: undefined,
    });
    expect(mockSetGlobalDispatcher).toHaveBeenCalledWith(dispatcher);
  });

  it('configures an HTTPS-only proxy', async () => {
    process.env.HTTPS_PROXY = 'http://https-proxy.test:8080';

    await loadProxyModule();

    expect(mockEnvHttpProxyAgent).toHaveBeenCalledWith({
      httpProxy: undefined,
      httpsProxy: 'http://https-proxy.test:8080',
      noProxy: undefined,
    });
  });

  it('honors lowercase variables and NO_PROXY exclusions', async () => {
    process.env.http_proxy = 'http://http-proxy.test:8080';
    process.env.https_proxy = 'http://https-proxy.test:8443';
    process.env.no_proxy = 'localhost,.internal.test';

    await loadProxyModule();

    expect(mockEnvHttpProxyAgent).toHaveBeenCalledWith({
      httpProxy: 'http://http-proxy.test:8080',
      httpsProxy: 'http://https-proxy.test:8443',
      noProxy: 'localhost,.internal.test',
    });
  });

  it('leaves the global dispatcher unchanged without a proxy', async () => {
    await loadProxyModule();

    expect(mockEnvHttpProxyAgent).not.toHaveBeenCalled();
    expect(mockSetGlobalDispatcher).not.toHaveBeenCalled();
  });
});
