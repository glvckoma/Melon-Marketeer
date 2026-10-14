const test = require('node:test');
const assert = require('node:assert');
const { parseProxyUrl } = require('../bot/utils/proxy.js');

test('parseProxyUrl returns null when no proxy is configured', () => {
  assert.strictEqual(parseProxyUrl(''), null);
  assert.strictEqual(parseProxyUrl(undefined), null);
});

test('parseProxyUrl splits host, port and decoded credentials', () => {
  const p = parseProxyUrl('http://us%40er:p%3Ass@10.0.0.5:8080');
  assert.strictEqual(p.host, '10.0.0.5');
  assert.strictEqual(p.port, 8080);
  assert.strictEqual(p.username, 'us@er');
  assert.strictEqual(p.password, 'p:ss');
});

test('parseProxyUrl defaults the port from the scheme', () => {
  assert.strictEqual(parseProxyUrl('http://proxy.local').port, 80);
  assert.strictEqual(parseProxyUrl('https://proxy.local').port, 443);
});
