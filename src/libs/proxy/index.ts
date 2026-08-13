/**
 * Self-hosted note: when setting HTTP_PROXY / HTTPS_PROXY, also set NO_PROXY to
 * cover localhost and intranet addresses. Otherwise the service's own outbound
 * requests (and intranet fetches) would be routed through the proxy as well.
 * Defaults are intentionally not changed here.
 */
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

const httpProxy = process.env.HTTP_PROXY || process.env.http_proxy;
const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy;

const noProxy = process.env.NO_PROXY || process.env.no_proxy;

if (httpProxy || httpsProxy) {
  setGlobalDispatcher(
    new EnvHttpProxyAgent({
      httpProxy,
      httpsProxy,
      noProxy,
    }),
  );
}
