function parseProxyUrl(raw = process.env.PROXY_URL) {
  if (!raw) return null;
  const url = new URL(raw);
  return {
    url: url.href,
    host: url.hostname,
    port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined
  };
}

let dispatcher;

function proxiedFetch(input, init = {}) {
  const proxy = parseProxyUrl();
  if (!proxy) return fetch(input, init);
  const undici = require('undici');
  dispatcher = dispatcher || new undici.ProxyAgent(proxy.url);
  return undici.fetch(input, { ...init, dispatcher });
}

module.exports = { parseProxyUrl, proxiedFetch };
