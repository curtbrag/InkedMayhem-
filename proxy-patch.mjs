import { ProxyAgent, setGlobalDispatcher } from 'undici';
const proxyUrl = process.env.https_proxy || process.env.HTTP_PROXY;
if (proxyUrl) {
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
  console.log('Proxy configured');
}
