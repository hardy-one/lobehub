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
